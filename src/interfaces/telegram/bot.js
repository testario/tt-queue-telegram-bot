import TelegramApi from "node-telegram-bot-api";
import {
  DEFAULT_GAME_TIME,
  TIME_READY,
  WORK_SCHEDULE,
} from "#application/config/time.js";
import { createLogger } from "#infrastructure/logger/Logger.js";
import { QueueService } from "#domain/services/QueueService.js";
import { InMemoryQueueRepository } from "#infrastructure/repositories/InMemoryQueueRepository.js";
import { EventNotifier } from "#infrastructure/notifier/EventNotifier.js";
import { NodeTimer } from "#infrastructure/timers/NodeTimer.js";
import { SystemClock } from "#infrastructure/time/SystemClock.js";
import { MatchOrchestrator } from "#application/services/MatchOrchestrator.js";
import { I18N_CONFIG } from "#application/config/i18n.js";
import { createLocalization } from "#application/messages/localization.js";
import { RegisterSearch } from "#application/usecases/RegisterSearch.js";
import { AddMatch } from "#application/usecases/AddMatch.js";
import { CreateDirectMatch } from "#application/usecases/CreateDirectMatch.js";
import { CancelSearch } from "#application/usecases/CancelSearch.js";
import { CancelMatch } from "#application/usecases/CancelMatch.js";
import { GetQueue } from "#application/usecases/GetQueue.js";
import { GetPlayed } from "#application/usecases/GetPlayed.js";
import { parseCallbackData } from "#application/parsers/callbackData.js";
import { UsageMetricsService } from "#application/services/UsageMetricsService.js";
import { MongoUsageMetricsRepository } from "#infrastructure/metrics/MongoUsageMetricsRepository.js";
import { Match } from "#domain";

/**
 * @typedef {import("#application/types.js").Logger} Logger
 * @typedef {import("#application/types.js").BotMessages} BotMessages
 * @typedef {import("#application/types.js").QueueRepository} QueueRepository
 * @typedef {import("#application/types.js").QueueService} QueueService
 * @typedef {import("#application/types.js").Notifier} Notifier
 * @typedef {import("#application/types.js").Timer} Timer
 * @typedef {import("#application/types.js").Clock} Clock
 * @typedef {import("#application/types.js").MatchLifecycle} MatchLifecycle
 */

/**
 * @typedef {Object} ChatContext
 * @property {number|string} chatId
 * @property {QueueService} queueService
 * @property {QueueRepository} repository
 * @property {Notifier} notifier
 * @property {Timer} timer
 * @property {Clock} clock
 * @property {MatchLifecycle} orchestrator
 * @property {RegisterSearch} registerSearch
 * @property {AddMatch} addMatch
 * @property {CreateDirectMatch} directMatch
 * @property {CancelSearch} cancelSearch
 * @property {CancelMatch} cancelMatch
 * @property {GetQueue} getQueue
 * @property {GetPlayed} getPlayed
 * @property {string|null} inlineMessageId
 */

/**
 * Создает и настраивает Telegram-бота с контекстами чатов.
 * @param {string} token
 * @param {{ logger?: Logger, locale?: string }} [options]
 * @returns {TelegramApi}
 */
const createBot = (token, { logger, locale } = {}) => {
  const { messages, ui, locale: currentLocale } = createLocalization({
    ...I18N_CONFIG,
    locale: locale || I18N_CONFIG.locale,
  });
  const log = logger || createLogger({ prefix: "bot" });
  log.info("Инициализация бота", { locale: currentLocale });
  const contexts = new Map();
  const userChatBindings = new Map();
  const metricsChatId = process.env.METRICS_CHAT_ID ? String(process.env.METRICS_CHAT_ID) : null;
  const metricsUri = process.env.METRICS_MONGODB_URI || process.env.MONGODB_URI || null;
  const metricsDb = process.env.METRICS_MONGODB_DB || process.env.MONGODB_DB || "tt-queue-bot";
  const metricsCollection = process.env.METRICS_MONGODB_COLLECTION || "usage_metrics";

  const metricsRepository =
    metricsUri && metricsDb
      ? new MongoUsageMetricsRepository({
          uri: metricsUri,
          dbName: metricsDb,
          collectionName: metricsCollection,
          logger: log.child("infra:metrics"),
        })
      : null;

  if (!metricsRepository) {
    log.warn("Метрики отключены: нет строки подключения к MongoDB");
  }

  const usageMetrics = new UsageMetricsService({
    repository: metricsRepository,
    logger: log.child("service:metrics"),
  });

  /**
   * Извлекает chatId из входящего сообщения.
   * @param {import("node-telegram-bot-api").Message} message
   * @returns {number|string|null}
   */
  const resolveChatIdFromMessage = (message) => message?.chat?.id || null;

  /**
   * Извлекает chatId из callback-запроса, учитывая возможную привязку пользователя.
   * @param {import("node-telegram-bot-api").CallbackQuery} callbackQuery
   * @returns {number|string|null}
   */
  const resolveChatIdFromCallback = (callbackQuery) =>
    callbackQuery?.message?.chat?.id || userChatBindings.get(callbackQuery?.from?.id) || null;

  /**
   * Возвращает chatId, если пользователь уже привязан к чату.
   * @param {number|string|null} userId
   * @returns {number|string|null}
   */
  const resolveChatIdFromUser = (userId) => (userId ? userChatBindings.get(userId) || null : null);

  /**
   * Привязывает пользователя к чату для дальнейших inline-операций.
   * @param {number|string|undefined} userId
   * @param {number|string|undefined} chatId
   * @returns {void}
   */
  const bindUserToChat = (userId, chatId) => {
    if (userId && chatId) {
      userChatBindings.set(userId, chatId);
      applyChatSlashCommands(chatId);
    }
  };

  /**
   * Безопасная запись события метрики (если хранилище настроено).
   * Данные пользователя и произвольные поля не передаются (обезличивание).
   * @param {string} type
   * @param {Record<string, unknown>} [payload]
   */
  const trackUsage = (type, payload = undefined) => {
    if (!type) return;
    usageMetrics.track({ type, payload });
  };

  const pauseModeChats = new Set();

  const normalizeChatKey = (chatId) =>
    chatId === null || chatId === undefined ? null : String(chatId);

  const isPauseModeEnabled = (chatId) => {
    const key = normalizeChatKey(chatId);
    return key ? pauseModeChats.has(key) : false;
  };

  const setPauseMode = (chatId, enabled) => {
    const key = normalizeChatKey(chatId);
    if (!key) return;
    if (enabled) {
      pauseModeChats.add(key);
    } else {
      pauseModeChats.delete(key);
    }
  };

  /**
   * Парсит период для метрик из строки вида "24h", "7d", "2w".
   * @param {string} rawRange
   * @returns {{ from?: Date, to?: Date, error?: string }}
   */
  const parseMetricsRange = (rawRange) => {
    const trimmed = (rawRange || "").trim();
    if (!trimmed) {
      const to = new Date();
      return { from: new Date(to.getTime() - 24 * 60 * 60 * 1000), to };
    }

    const match = trimmed.match(/^(\d+)\s*(h|d|w)$/i);
    if (!match) {
      return { error: "invalid" };
    }

    const value = Number(match[1]);
    const unit = match[2].toLowerCase();
    const unitMs = {
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
      w: 7 * 24 * 60 * 60 * 1000,
    }[unit];

    if (!unitMs || value <= 0) {
      return { error: "invalid" };
    }

    const to = new Date();
    return { from: new Date(to.getTime() - value * unitMs), to };
  };

  /**
   * Нормализует result_id inline-результата для метрик без пользовательских данных.
   * @param {string|undefined|null} resultId
   * @returns {{ category: string, variant: string }}
   */
  const normalizeInlineResultForMetrics = (resultId) => {
    if (!resultId) return { category: "unknown", variant: "unknown" };
    if (resultId.startsWith("direct:")) {
      return { category: "direct", variant: "direct" };
    }
    if (resultId === "1") return { category: "preset", variant: "search" };
    if (resultId === "2") return { category: "preset", variant: "queue" };
    if (resultId === "3") return { category: "preset", variant: "played" };
    if (resultId.startsWith("test:")) return { category: "test", variant: "test" };
    return { category: "other", variant: "other" };
  };

  const bot = new TelegramApi(token, {
    polling: {
      params: {
        // Явно указываем нужные апдейты, чтобы получать chosen_inline_result
        allowed_updates: ["inline_query", "chosen_inline_result", "callback_query", "message"],
      },
    },
  });
  log.info("Бот запущен в режиме polling");

  const globalSlashCommands = [{ command: "start", description: ui.commands.start }];
  const chatSlashCommands = [
    { command: "play", description: ui.commands.play },
    { command: "search", description: ui.commands.search },
    { command: "queue", description: ui.commands.queue },
    { command: "played", description: ui.commands.played },
    { command: "pause", description: ui.commands.pause },
    { command: "continue", description: ui.commands.continue },
  ];

  const applyGlobalSlashCommands = async () => {
    try {
      await bot.setMyCommands(globalSlashCommands, { language_code: currentLocale });
      log.info("Глобальное меню слэш-команд обновлено", {
        locale: currentLocale,
        commands: globalSlashCommands.map(({ command }) => command),
      });
    } catch (error) {
      log.error("Не удалось установить глобальные слэш-команды", { message: error.message });
    }
  };

  const commandsAppliedForChats = new Set();
  const applyChatSlashCommands = async (chatId) => {
    if (!chatId || commandsAppliedForChats.has(chatId)) return;
    commandsAppliedForChats.add(chatId);

    const commands =
      metricsChatId && String(chatId) === String(metricsChatId)
        ? [...chatSlashCommands, { command: "metrics", description: ui.commands.metrics }]
        : chatSlashCommands;

    try {
      await bot.setMyCommands(commands, {
        language_code: currentLocale,
        scope: { type: "chat", chat_id: chatId },
      });
      log.info("Меню слэш-команд для чата обновлено", {
        locale: currentLocale,
        chatId,
        commands: commands.map(({ command }) => command),
      });
    } catch (error) {
      log.error("Не удалось установить слэш-команды для чата", { message: error.message, chatId });
    }
  };

  const isUserAdmin = async (chatId, userId) => {
    if (!chatId || !userId) return false;
    try {
      const member = await bot.getChatMember(chatId, userId);
      return ["administrator", "creator"].includes(member?.status);
    } catch (error) {
      log.error("Не удалось проверить права администратора", {
        chatId,
        userId,
        message: error.message,
      });
      return false;
    }
  };

  const ensureAdminOrReply = async ({ chatId, userId, replyToMessageId }) => {
    const admin = await isUserAdmin(chatId, userId);
    if (!admin) {
      await bot.sendMessage(
        chatId,
        messages.adminOnly(),
        replyToMessageId ? { reply_to_message_id: replyToMessageId } : undefined
      );
    }
    return admin;
  };

  applyGlobalSlashCommands();
  let isStopped = false;
  const MAX_TEST_MATCHES = 10;
  const isTestFeatureEnabled = process.env.ENABLE_TEST_FEATURE === "true";

  /**
   * Проверяет, является ли ошибка "message is not modified".
   * @param {unknown} error
   * @returns {boolean}
   */
  const isMessageNotModifiedError = (error) =>
    error?.response?.body?.description?.includes("message is not modified");

  /**
   * Логирует ошибки редактирования сообщений с подавлением "message is not modified".
   * @param {Error & { response?: { body?: { description?: string }}}} error
   * @param {string} context
   * @returns {void}
   */
  const handleEditMessageError = (error, context) => {
    if (isMessageNotModifiedError(error)) {
      log.debug(`${context} пропущена: message is not modified`);
      return;
    }
    log.error(context, { message: error.message });
  };

  /**
   * Возвращает контекст для чата или создает новый.
   * @param {number|string|null} chatId
   * @returns {ChatContext|null}
   */
  const getContext = (chatId) => {
    if (!chatId) return null;
    if (contexts.has(chatId)) {
      return contexts.get(chatId);
    }

    const queueService = new QueueService({
      readyMs: TIME_READY,
      gameMs: DEFAULT_GAME_TIME,
      workSchedule: WORK_SCHEDULE,
    });
    const repository = new InMemoryQueueRepository(queueService.createInitialState());
    const notifier = new EventNotifier();
    const timer = new NodeTimer();
    const clock = new SystemClock();

    const orchestrator = new MatchOrchestrator({
      chatId,
      timer,
      notifier,
      repository,
      queueService,
      messages,
      clock,
      logger: log.child(`service:orchestrator:${chatId}`),
    });

    const registerSearch = new RegisterSearch({
      repository,
      queueService,
      messages,
      clock,
      logger: log.child(`usecase:RegisterSearch:${chatId}`),
    });
    const addMatch = new AddMatch({
      chatId,
      repository,
      queueService,
      orchestrator,
      notifier,
      messages,
      clock,
      logger: log.child(`usecase:AddMatch:${chatId}`),
    });
    const directMatch = new CreateDirectMatch({
      registerSearch,
      messages,
      logger: log.child(`usecase:CreateDirectMatch:${chatId}`),
    });
    const cancelSearch = new CancelSearch({
      repository,
      queueService,
      messages,
      clock,
      logger: log.child(`usecase:CancelSearch:${chatId}`),
    });
    const cancelMatch = new CancelMatch({
      chatId,
      repository,
      queueService,
      orchestrator,
      notifier,
      messages,
      clock,
      logger: log.child(`usecase:CancelMatch:${chatId}`),
    });
    const getQueue = new GetQueue({
      repository,
      messages,
      logger: log.child(`usecase:GetQueue:${chatId}`),
    });
    const getPlayed = new GetPlayed({
      repository,
      queueService,
      messages,
      clock,
      logger: log.child(`usecase:GetPlayed:${chatId}`),
    });

    const context = {
      chatId,
      queueService,
      repository,
      notifier,
      timer,
      clock,
      orchestrator,
      registerSearch,
      addMatch,
      directMatch,
      cancelSearch,
      cancelMatch,
      getQueue,
      getPlayed,
      inlineMessageId: null,
    };

    notifier.onMessage(({ chatId: targetChatId, text, meta }) => {
      if (targetChatId !== chatId) return;

      const replyMarkup =
        meta && meta.match && (meta.type === "match_created" || meta.type === "match_started")
          ? buildMatchCancelKeyboard(meta.match)
          : undefined;

      bot
        .sendMessage(chatId, text, replyMarkup ? { reply_markup: replyMarkup } : undefined)
        .catch((error) =>
          log.error("Не удалось отправить уведомление", {
            chatId,
            message: error.message,
          })
        );
    });

    contexts.set(chatId, context);
    applyChatSlashCommands(chatId);
    return context;
  };

  /**
   * Формирует клавиатуру для inline-заявки на поиск соперника.
   * @param {string} player
   * @returns {{ inline_keyboard: Array<Array<{ text: string, callback_data: string }>> }}
   */
  const buildSearchInlineKeyboard = (player) => ({
    inline_keyboard: [
      [
        {
          text: ui.inline.playWith,
          callback_data: "i_want_to_play_with_:" + player,
        },
        {
          text: ui.inline.cancelOwn,
          callback_data: "i_want_to_cancel:" + player,
        },
      ],
    ],
  });

  /**
   * Формирует клавиатуру для отмены созданного матча участниками.
   * @param {{ player1: string, player2: string }} match
   * @returns {{ inline_keyboard: Array<Array<{ text: string, callback_data: string }>> }}
   */
  const buildMatchCancelKeyboard = (match) => ({
    inline_keyboard: [
      [
        {
          text: ui.inline.confirmNoTime,
          callback_data: `i_want_to_out:${match.player1},${match.player2}`,
        },
      ],
    ],
  });

  const freezeQueueForPause = async (context) => {
    if (!context) return { hasQueue: false };
    context.orchestrator.cancelAll();
    const state = await context.repository.get();
    if (!state.queue.length) {
      return { hasQueue: false };
    }
    state.queue.forEach((item) => {
      item.status = Match.statuses.waiting;
    });
    context.queueService.recalculateWaiting(state);
    await context.repository.save(state);
    return { hasQueue: true, nextMatch: state.queue[0] };
  };

  const resumeQueueAfterPause = async (context) => {
    if (!context) return { hasQueue: false };
    const state = await context.repository.get();
    if (!state.queue.length) {
      return { hasQueue: false };
    }
    const now = context.clock.now();
    const nextMatch = state.queue[0];
    nextMatch.status = Match.statuses.playing;
    nextMatch.startDate = new Date(now.getTime() + context.queueService.readyMs);
    nextMatch.endDate = new Date(nextMatch.startDate.getTime() + context.queueService.gameMs);
    context.queueService.recalculateWaiting(state);
    await context.repository.save(state);
    context.orchestrator.scheduleLifecycle(nextMatch);
    return { hasQueue: true, nextMatch };
  };

  const notifyQueuePausedIfNeeded = async (chatId, replyToMessageId) => {
    if (!isPauseModeEnabled(chatId)) return;
    await bot.sendMessage(
      chatId,
      messages.pauseModeOnHold(),
      replyToMessageId ? { reply_to_message_id: replyToMessageId } : undefined
    );
  };

  /**
   * Создает указанное количество тестовых матчей для заданного чата.
   * @param {number|string|null} chatId
   * @param {number} count
   * @returns {Promise<{created: Array<{searcher: string, opponent: string}>, failed: Array<{searcher?: string, opponent?: string, reason?: string, text: string}>}>}
   */
  const createTestMatches = async (chatId, count) => {
    const context = getContext(chatId);
    if (!context) {
      return { created: [], failed: [{ reason: "no_context", text: ui.callback.contextNotFound }] };
    }

    const { registerSearch, addMatch } = context;
    const testCount = Math.min(count, MAX_TEST_MATCHES);
    const timestamp = Date.now();
    const created = [];
    const failed = [];

    for (let i = 0; i < testCount; i += 1) {
      const searcher = ui.test.playerName({ timestamp, index: i, suffix: "A" });
      const opponent = ui.test.playerName({ timestamp, index: i, suffix: "B" });

      await registerSearch.execute(searcher);
      const addResult = await addMatch.execute(searcher, opponent, {
        scheduleLifecycle: !isPauseModeEnabled(chatId),
      });

      if (addResult.ok) {
        created.push({ searcher, opponent });
      } else {
        failed.push({ searcher, opponent, reason: addResult.reason, text: addResult.text });
      }
    }

    return { created, failed };
  };

  /**
   * Собирает краткое описание созданных тестовых матчей.
   * @param {Array<{searcher: string, opponent: string}>} created
   * @returns {string}
   */
  const formatTestSummary = (created) => ui.test.summary(created);

  /**
   * Останавливает бота и очищает активные таймеры для всех контекстов.
   * @param {number|string} chatId
   * @param {string|undefined} username
   * @returns {Promise<void>}
   */
  const stopBot = async (chatId, username) => {
    if (isStopped) {
      log.info("Получена повторная команда /stop, бот уже остановлен", { chatId, username });
      return;
    }
    isStopped = true;
    log.warn("Остановка бота по команде /stop", { chatId, username });
    contexts.forEach((context) => {
      try {
        context.orchestrator.cancelAll();
      } catch (error) {
        log.error("Ошибка при отмене таймеров", {
          chatId: context.chatId,
          message: error.message,
        });
      }
    });
    try {
      await bot.sendMessage(chatId, messages.botStopped());
    } catch (error) {
      log.error("Не удалось отправить сообщение об остановке", { message: error.message });
    }
    try {
      await bot.stopPolling();
      log.info("Polling остановлен");
    } catch (error) {
      log.error("Ошибка остановки polling", { message: error.message });
    }
  };

  /**
   * Перезапускает polling, если бот был остановлен.
   * @param {number|string} chatId
   * @param {string|undefined} username
   * @returns {Promise<void>}
   */
  const startBotIfStopped = async (chatId, username) => {
    if (!isStopped) {
      return;
    }
    log.info("Перезапуск polling по команде /start", { chatId, username });
    try {
      await bot.startPolling();
      isStopped = false;
      log.info("Polling возобновлен");
    } catch (error) {
      log.error("Ошибка возобновления polling", { message: error.message });
    }
  };

  bot.onText(/\/start/, async (msg) => {
    const chatId = resolveChatIdFromMessage(msg);
    const userId = msg.from?.id;
    const username = msg.from?.username;
    bindUserToChat(userId, chatId);
    getContext(chatId);
    await startBotIfStopped(chatId, username);
    log.info("Получена команда /start", { chatId, username });
    trackUsage("command:start", { restarted: isStopped });
    bot.sendMessage(chatId, messages.greet());
  });

  bot.onText(/\/stop/, async (msg) => {
    const chatId = msg.chat.id;
    trackUsage("command:stop");
    await stopBot(chatId, username);
  });

  bot.onText(/\/pause(?:@[\w_]+)?/, async (msg) => {
    const chatId = resolveChatIdFromMessage(msg);
    const userId = msg.from?.id;
    const username = msg.from?.username;

    trackUsage("command:pause");

    if (!chatId) {
      log.warn("Команда /pause без chatId", { userId, username });
      return;
    }

    const context = getContext(chatId);
    if (!context) {
      await bot.sendMessage(chatId, ui.callback.contextMissing);
      log.warn("Контекст не найден для команды /pause", { chatId });
      return;
    }

    const isAdmin = await ensureAdminOrReply({
      chatId,
      userId,
      replyToMessageId: msg.message_id,
    });
    if (!isAdmin) return;

    if (isPauseModeEnabled(chatId)) {
      await bot.sendMessage(chatId, messages.pauseModeAlreadyEnabled(), {
        reply_to_message_id: msg.message_id,
      });
      return;
    }

    setPauseMode(chatId, true);
    const freezeResult = await freezeQueueForPause(context);
    log.info("Режим паузы включен", { chatId, username, queueFrozen: freezeResult.hasQueue });

    await bot.sendMessage(chatId, messages.pauseModeEnabled(), {
      reply_to_message_id: msg.message_id,
    });
  });

  bot.onText(/\/continue(?:@[\w_]+)?/, async (msg) => {
    const chatId = resolveChatIdFromMessage(msg);
    const userId = msg.from?.id;
    const username = msg.from?.username;

    trackUsage("command:continue");

    if (!chatId) {
      log.warn("Команда /continue без chatId", { userId, username });
      return;
    }

    const context = getContext(chatId);
    if (!context) {
      await bot.sendMessage(chatId, ui.callback.contextMissing);
      log.warn("Контекст не найден для команды /continue", { chatId });
      return;
    }

    const isAdmin = await ensureAdminOrReply({
      chatId,
      userId,
      replyToMessageId: msg.message_id,
    });
    if (!isAdmin) return;

    if (!isPauseModeEnabled(chatId)) {
      await bot.sendMessage(chatId, messages.pauseModeNotEnabled(), {
        reply_to_message_id: msg.message_id,
      });
      return;
    }

    setPauseMode(chatId, false);
    const resumeResult = await resumeQueueAfterPause(context);
    log.info("Режим паузы выключен", { chatId, username, queueStarted: resumeResult.hasQueue });

    if (!resumeResult.hasQueue) {
      await bot.sendMessage(chatId, messages.pauseModeDisabledNoQueue(), {
        reply_to_message_id: msg.message_id,
      });
      return;
    }

    const { nextMatch } = resumeResult;
    await bot.sendMessage(
      chatId,
      messages.pauseModeDisabled({
        player1: nextMatch.player1,
        player2: nextMatch.player2,
        startDate: nextMatch.startDate,
      }),
      { reply_to_message_id: msg.message_id }
    );
  });

  bot.onText(/\/metrics(?:@[\w_]+)?(?:\s+(.+))?/, async (msg, match) => {
    const chatId = resolveChatIdFromMessage(msg);
    const rangeRaw = (match && match[1]) || "";

    trackUsage("command:metrics", { hasRange: Boolean(rangeRaw.trim()) });

    if (!usageMetrics.isEnabled()) {
      await bot.sendMessage(chatId, messages.metricsDisabled());
      return;
    }

    if (!metricsChatId || String(chatId) !== String(metricsChatId)) {
      log.warn("Запрос метрик отклонен: неверный чат", { chatId, metricsChatId, userId });
      await bot.sendMessage(chatId, messages.metricsAccessDenied());
      return;
    }

    const range = parseMetricsRange(rangeRaw);
    if (range.error) {
      await bot.sendMessage(chatId, messages.metricsRangeInvalid(), {
        reply_to_message_id: msg.message_id,
      });
      return;
    }

    const summaryResult = await usageMetrics.getSummary({ ...range, limit: 25 });
    if (!summaryResult.ok) {
      await bot.sendMessage(chatId, messages.metricsUnavailable());
      return;
    }

    const summary = summaryResult.summary;
    if (!summary.total) {
      await bot.sendMessage(chatId, messages.metricsEmpty({ from: range.from, to: range.to }));
      return;
    }

    const text = messages.metricsSummary({
      from: range.from || summary.firstEventAt,
      to: range.to || summary.lastEventAt,
      total: summary.total,
      byType: summary.byType,
      inlineVariants: summary.inlineVariants,
    });
    await bot.sendMessage(chatId, text);
  });

  bot.onText(/\/search(?:@[\w_]+)?/, async (msg) => {
    const chatId = resolveChatIdFromMessage(msg);
    const userId = msg.from?.id;
    const username = msg.from?.username;
    const player = username ? `@${username}` : null;

    trackUsage("command:search");

    if (!chatId) {
      log.warn("Команда /search без chatId", { userId, username });
      return;
    }

    if (!player) {
      await bot.sendMessage(chatId, messages.usernameRequired());
      return;
    }

    const context = getContext(chatId);
    if (!context) {
      await bot.sendMessage(chatId, ui.callback.contextMissing);
      log.warn("Контекст не найден для команды /search", { chatId });
      return;
    }

    bindUserToChat(userId, chatId);

    try {
      const searchResult = await context.registerSearch.execute(player);
      const replyMarkup =
        searchResult.status === "added" || searchResult.status === "already_searching"
          ? buildSearchInlineKeyboard(player)
          : undefined;

      await bot.sendMessage(chatId, searchResult.text, {
        reply_to_message_id: msg.message_id,
        reply_markup: replyMarkup,
      });
    } catch (error) {
      log.error("Ошибка при выполнении /search", { chatId, message: error.message });
      await bot.sendMessage(chatId, ui.callback.contextNotFound);
    }
  });

  bot.onText(/\/queue/, async (msg) => {
    const chatId = resolveChatIdFromMessage(msg);
    const userId = msg.from?.id;
    const username = msg.from?.username;

    trackUsage("command:queue");

    if (!chatId) {
      log.warn("Команда /queue без chatId", { userId, username });
      return;
    }

    const context = getContext(chatId);
    if (!context) {
      await bot.sendMessage(chatId, ui.callback.contextMissing);
      log.warn("Контекст не найден для команды /queue", { chatId });
      return;
    }

    try {
      const queueText = await context.getQueue.execute();
      await bot.sendMessage(chatId, queueText, { reply_to_message_id: msg.message_id });
    } catch (error) {
      log.error("Ошибка при выполнении /queue", { chatId, message: error.message });
      await bot.sendMessage(chatId, ui.callback.contextNotFound);
    }
  });

  bot.onText(/\/played/, async (msg) => {
    const chatId = resolveChatIdFromMessage(msg);
    const userId = msg.from?.id;
    const username = msg.from?.username;

    trackUsage("command:played");

    if (!chatId) {
      log.warn("Команда /played без chatId", { userId, username });
      return;
    }

    const context = getContext(chatId);
    if (!context) {
      await bot.sendMessage(chatId, ui.callback.contextMissing);
      log.warn("Контекст не найден для команды /played", { chatId });
      return;
    }

    try {
      const playedText = await context.getPlayed.execute();
      await bot.sendMessage(chatId, playedText, { reply_to_message_id: msg.message_id });
    } catch (error) {
      log.error("Ошибка при выполнении /played", { chatId, message: error.message });
      await bot.sendMessage(chatId, ui.callback.contextNotFound);
    }
  });

  bot.onText(/^\/play(?:@[\w_]+)?\s+(@[\w_]+)/, async (msg, match) => {
    const chatId = resolveChatIdFromMessage(msg);
    const userId = msg.from?.id;
    const username = msg.from?.username;
    const player = username ? `@${username}` : null;
    const opponentRaw = (match && match[1]) || "";

    trackUsage("command:play", { hasOpponent: Boolean(opponentRaw.trim()) });

    if (!chatId) {
      log.warn("Команда /play без chatId", { userId, username });
      return;
    }

    const context = getContext(chatId);
    if (!context) {
      bot
        .sendMessage(chatId, ui.callback.contextMissing)
        .catch((error) => log.error("Не удалось отправить ответ о контексте для /play", { message: error.message }));
      log.warn("Контекст не найден для команды /play", { chatId });
      return;
    }

    bindUserToChat(userId, chatId);
    log.info("Получена команда /play", { chatId, player, opponentRaw });

    try {
      const result = await context.directMatch.execute(player, opponentRaw);
      trackUsage("usecase:direct_match", { ok: result.ok, reason: result.reason });
      if (!result.ok) {
        await bot.sendMessage(chatId, result.text, {
          reply_to_message_id: msg.message_id,
        });
        return;
      }

      const { invite } = result;
      await bot.sendMessage(chatId, result.text, {
        reply_to_message_id: msg.message_id,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: ui.inline.directAccept,
                callback_data: `direct_accept:${invite.player},${invite.opponent}`,
              },
              {
                text: ui.inline.directDecline,
                callback_data: `direct_decline:${invite.player},${invite.opponent}`,
              },
            ],
            [
              {
                text: ui.inline.directCancel,
                callback_data: `direct_cancel:${invite.player},${invite.opponent}`,
              },
            ],
          ],
        },
      });
    } catch (error) {
      log.error("Ошибка при прямом создании матча через /play", {
        chatId,
        message: error.message,
      });
      bot
        .sendMessage(chatId, ui.callback.contextNotFound)
        .catch((sendError) =>
          log.error("Не удалось отправить сообщение об ошибке /play", { message: sendError.message })
        );
    }
  });

  bot.on("inline_query", async (query) => {
    const player = "@" + query.from.username;
    const opponentRaw = (query.query || "").trim();
    const encodedOpponent = opponentRaw ? encodeURIComponent(opponentRaw) : "";
    const chatId = resolveChatIdFromUser(query.from?.id);
    log.info("Получен inline запрос", { player, chatId });
    trackUsage("inline:query", { hasOpponent: Boolean(opponentRaw) });

    if (!chatId) {
      bot.answerInlineQuery(
        query.id,
        [
          {
            type: "article",
            id: "no_chat_binding",
            title: ui.inline.noChatBinding.title,
            input_message_content: {
              message_text: ui.inline.noChatBinding.text,
            },
            description: ui.inline.noChatBinding.description,
          },
        ],
        { cache_time: 1, is_personal: true }
      );
      return;
    }

    const context = getContext(chatId);
    if (!context) {
      log.warn("Контекст чата не найден для inline запроса", { chatId });
      bot.answerInlineQuery(
        query.id,
        [
          {
            type: "article",
            id: "no_context",
            title: ui.inline.contextNotReady.title,
            input_message_content: {
              message_text: ui.inline.contextNotReady.text,
            },
            description: ui.inline.contextNotReady.description,
          },
        ],
        { cache_time: 1, is_personal: true }
      );
      return;
    }

    const queueText = await context.getQueue.execute();
    const playedText = await context.getPlayed.execute();

    const results = [
      {
        type: "article",
        id: "1",
        title: ui.inline.search.title,
        input_message_content: {
          message_text: messages.searchAdded(player),
        },
        description: ui.inline.search.description,
        reply_markup: {
          inline_keyboard: buildSearchInlineKeyboard(player).inline_keyboard,
        },
      },
      {
        type: "article",
        id: "2",
        title: ui.inline.queue.title,
        input_message_content: {
          message_text: queueText,
        },
        description: ui.inline.queue.description,
      },
      {
        type: "article",
        id: "3",
        title: ui.inline.played.title,
        input_message_content: {
          message_text: playedText,
        },
        description: ui.inline.played.description,
      },
    ];

    if (opponentRaw) {
      results.unshift({
        type: "article",
        id: `direct:${encodedOpponent}`,
        title: ui.inline.directTitle(opponentRaw),
        input_message_content: {
          message_text: ui.inline.directPreview(opponentRaw),
        },
        description: ui.inline.directDescription(opponentRaw),
      });
    }

    if (isTestFeatureEnabled) {
      results.push(
        {
          type: "article",
          id: "test:1",
          title: ui.inline.test.createTitle(1),
          input_message_content: {
            message_text: ui.inline.test.createText(1),
          },
          description: ui.inline.test.createDescription(1),
          reply_markup: {
            inline_keyboard: [[{ text: ui.inline.test.createButton, callback_data: "inline_test:1" }]],
          },
        },
        {
          type: "article",
          id: "test:3",
          title: ui.inline.test.createTitle(3),
          input_message_content: {
            message_text: ui.inline.test.createText(3),
          },
          description: ui.inline.test.createDescription(3),
          reply_markup: {
            inline_keyboard: [[{ text: ui.inline.test.createButton, callback_data: "inline_test:3" }]],
          },
        },
        {
          type: "article",
          id: "test:5",
          title: ui.inline.test.createTitle(5),
          input_message_content: {
            message_text: ui.inline.test.createText(5),
          },
          description: ui.inline.test.createDescription(5),
          reply_markup: {
            inline_keyboard: [[{ text: ui.inline.test.createButton, callback_data: "inline_test:5" }]],
          },
        }
      );
    }

    bot.answerInlineQuery(query.id, results, { cache_time: 1, is_personal: true });
  });

  bot.on("chosen_inline_result", async (result) => {
    const player = "@" + result.from.username;
    const userId = result.from?.id;
    const chatId = resolveChatIdFromUser(userId);
    const context = chatId ? getContext(chatId) : null;
    if (!context) {
      log.warn("Игрок выбрал inline результат без привязки к чату", { player, userId });
      return;
    }

    const { registerSearch } = context;
    const inlineMessageId = result.inline_message_id;
    const resultId = result.result_id;

    log.info("Выбран inline результат", { player, resultId, chatId });
    const normalizedInline = normalizeInlineResultForMetrics(resultId);
    trackUsage("inline:choose", {
      category: normalizedInline.category,
      variant: normalizedInline.variant,
      hasContext: Boolean(context),
    });
    context.inlineMessageId = inlineMessageId || context.inlineMessageId;
    bindUserToChat(userId, chatId);

    if (resultId === "1") {
      try {
        const searchResult = await registerSearch.execute(player);
        log.debug("Статус регистрации после выбора inline", { player, status: searchResult.status });

        if (inlineMessageId) {
          bot
            .editMessageText(searchResult.text, {
              inline_message_id: inlineMessageId,
              reply_markup: buildSearchInlineKeyboard(player),
            })
            .catch((error) => handleEditMessageError(error, "Не удалось обновить inline сообщение поиска"));
        }
      } catch (error) {
        log.error("Ошибка регистрации поиска после выбора inline", { player, message: error.message });
      }
    } else if (resultId?.startsWith("direct:")) {
      const opponentRaw = decodeURIComponent(resultId.replace("direct:", ""));
      const directResult = await context.directMatch.execute(player, opponentRaw);

      // Всегда отправляем приглашение в общий чат
      const sendInvite = (text, invite) =>
        bot.sendMessage(chatId, text, {
          reply_markup:
            invite && invite.player && invite.opponent
              ? {
                  inline_keyboard: [
                    [
                      {
                        text: ui.inline.directAccept,
                        callback_data: `direct_accept:${invite.player},${invite.opponent}`,
                      },
                      {
                        text: ui.inline.directDecline,
                        callback_data: `direct_decline:${invite.player},${invite.opponent}`,
                      },
                    ],
                    [
                      {
                        text: ui.inline.directCancel,
                        callback_data: `direct_cancel:${invite.player},${invite.opponent}`,
                      },
                    ],
                  ],
                }
              : undefined,
        });

      if (!directResult.ok) {
        await sendInvite(directResult.text);
        if (inlineMessageId) {
          bot
            .editMessageText(directResult.text, { inline_message_id: inlineMessageId })
            .catch((error) =>
              handleEditMessageError(error, "Не удалось обновить inline сообщение direct приглашения (ошибка)")
            );
        }
        return;
      }

      const { invite } = directResult;
      await sendInvite(directResult.text, invite);

      if (inlineMessageId) {
        bot
          .editMessageText(" ", {
            inline_message_id: inlineMessageId,
            reply_markup: { inline_keyboard: [] },
          })
          .catch((error) =>
            handleEditMessageError(error, "Не удалось очистить inline сообщение после отправки приглашения")
          );
      }
    }
  });

  bot.on("callback_query", async (callbackQuery) => {
    const callbackId = callbackQuery.id;
    const messageId = callbackQuery.inline_message_id;
    const player2 = "@" + callbackQuery.from.username;
    const chatId = resolveChatIdFromCallback(callbackQuery);
    const userId = callbackQuery.from?.id;
    if (!chatId) {
      bot
        .answerCallbackQuery(callbackId, {
          text: ui.callback.startDialogRequired,
          show_alert: true,
        })
        .catch(console.error);
      log.warn("Callback без привязки к чату", { player: player2, userId });
      return;
    }
    const context = getContext(chatId);
    if (!context) {
      bot
        .answerCallbackQuery(callbackId, {
          text: ui.callback.contextMissing,
          show_alert: true,
        })
        .catch(console.error);
      log.warn("Контекст не найден для callback", { chatId, player: player2 });
      return;
    }

    context.inlineMessageId = messageId || context.inlineMessageId;
    bindUserToChat(userId, chatId);
    const { addMatch, cancelSearch, cancelMatch } = context;
    const parsed = parseCallbackData(callbackQuery.data || "");
    log.info("Обработка callback", { type: parsed.type, player: player2, chatId });
    trackUsage(`callback:${parsed.type || "unknown"}`, {
      hasMessageId: Boolean(messageId),
    });

    if (parsed.type === "play_with") {
      const player1 = parsed.player;
      const addResult = await addMatch.execute(player1, player2, {
        scheduleLifecycle: !isPauseModeEnabled(chatId),
      });
      if (addResult.ok) {
        log.info("Матч принят через callback", { player1, player2 });
        bot
          .editMessageText(addResult.text, {
            inline_message_id: messageId,
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: ui.inline.confirmNoTime,
                    callback_data: `i_want_to_out:${player1},${player2}`,
                  },
                ],
              ],
            },
          })
          .catch((error) =>
            handleEditMessageError(error, "Не удалось обновить inline сообщение подтверждения матча")
          );
        await notifyQueuePausedIfNeeded(chatId, callbackQuery.message?.message_id);
      } else {
        log.warn("Не удалось создать матч через callback", {
          player1,
          player2,
          reason: addResult.reason,
        });
        bot
          .answerCallbackQuery(callbackId, {
            text: addResult.text,
            show_alert: true,
          })
          .catch(console.error);
      }
    } else if (parsed.type === "cancel_search") {
      if (player2 !== parsed.player) {
        log.warn("Попытка отменить чужой поиск", { requester: player2, owner: parsed.player });
        bot
          .answerCallbackQuery(callbackId, {
            text: ui.callback.cancelNotAuthor,
            show_alert: true,
          })
          .catch(console.error);
        return;
      }
      const cancelResult = await cancelSearch.execute(parsed.player);
      if (cancelResult.status === "removed") {
        bot
          .editMessageText(messages.searchCancelled(), {
            inline_message_id: messageId,
          })
          .catch((error) =>
            handleEditMessageError(error, "Не удалось обновить inline сообщение об отмене поиска")
          );
      } else {
        bot
          .answerCallbackQuery(callbackId, {
            text: ui.callback.cancelAlreadyRemoved,
            show_alert: true,
          })
          .catch(console.error);
      }
    } else if (parsed.type === "cancel_match") {
      const playersInQueue = parsed.players;
      if (!playersInQueue.includes(player2)) {
        log.warn("Попытка отменить чужой матч", { requester: player2, playersInQueue });
        bot
          .answerCallbackQuery(callbackId, {
            text: ui.callback.cancelForeignMatch,
            show_alert: true,
          })
          .catch(console.error);
        return;
      }
      const cancelResult = await cancelMatch.execute(player2);
      if (!cancelResult.ok) {
        log.warn("Матч для отмены не найден", { player: player2 });
        bot
          .answerCallbackQuery(callbackId, {
            text: ui.callback.matchNotFound,
            show_alert: true,
          })
          .catch(console.error);
      } else {
        log.info("Матч отменен по callback", { player: player2, status: cancelResult.status });
        bot
          .editMessageText(ui.callback.matchCancelled, {
            inline_message_id: messageId,
          })
          .catch((error) =>
            handleEditMessageError(error, "Не удалось обновить inline сообщение об отмене матча")
          );
      }
    } else if (parsed.type === "direct_accept") {
      const [player1, invited] = parsed.players || [];
      const editTarget = messageId
        ? { inline_message_id: messageId }
        : { chat_id: chatId, message_id: callbackQuery.message?.message_id };

      if (!player1 || !invited) {
        bot
          .answerCallbackQuery(callbackId, {
            text: ui.callback.contextNotFound,
            show_alert: true,
          })
          .catch(console.error);
        return;
      }

      if (player2 !== invited) {
        bot
          .answerCallbackQuery(callbackId, {
            text: ui.callback.directNotTarget,
            show_alert: true,
          })
          .catch(console.error);
        return;
      }

      const addResult = await addMatch.execute(player1, player2, {
        scheduleLifecycle: !isPauseModeEnabled(chatId),
      });
      if (addResult.ok) {
        bot
          .editMessageText(addResult.text, {
            ...editTarget,
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: ui.inline.confirmNoTime,
                    callback_data: `i_want_to_out:${player1},${player2}`,
                  },
                ],
              ],
            },
          })
          .catch((error) =>
            handleEditMessageError(error, "Не удалось обновить сообщение о принятии прямого матча")
          );
        await notifyQueuePausedIfNeeded(chatId, callbackQuery.message?.message_id);
      } else {
        bot
          .answerCallbackQuery(callbackId, {
            text: addResult.text,
            show_alert: true,
          })
          .catch(console.error);
      }
    } else if (parsed.type === "direct_decline") {
      const [player1, invited] = parsed.players || [];
      const editTarget = messageId
        ? { inline_message_id: messageId }
        : { chat_id: chatId, message_id: callbackQuery.message?.message_id };

      if (!player1 || !invited) {
        bot
          .answerCallbackQuery(callbackId, {
            text: ui.callback.contextNotFound,
            show_alert: true,
          })
          .catch(console.error);
        return;
      }

      if (player2 !== invited) {
        bot
          .answerCallbackQuery(callbackId, {
            text: ui.callback.directNotTarget,
            show_alert: true,
          })
          .catch(console.error);
        return;
      }

      await cancelSearch.execute(player1);
      bot
        .editMessageText(messages.directDeclined({ from: player1, to: player2 }), {
          ...editTarget,
        })
        .catch((error) =>
          handleEditMessageError(error, "Не удалось обновить сообщение об отказе в прямом матче")
        );
    } else if (parsed.type === "direct_cancel") {
      const [player1, invited] = parsed.players || [];
      const editTarget = messageId
        ? { inline_message_id: messageId }
        : { chat_id: chatId, message_id: callbackQuery.message?.message_id };
      const canDelete =
        callbackQuery.message?.chat?.id !== undefined &&
        callbackQuery.message?.message_id !== undefined;

      if (!player1 || !invited) {
        bot
          .answerCallbackQuery(callbackId, {
            text: ui.callback.contextNotFound,
            show_alert: true,
          })
          .catch(console.error);
        return;
      }

      if (player2 !== player1) {
        bot
          .answerCallbackQuery(callbackId, {
            text: ui.callback.directNotAuthor,
            show_alert: true,
          })
          .catch(console.error);
        return;
      }

      await cancelSearch.execute(player1);
      if (canDelete) {
        bot
          .deleteMessage(chatId, callbackQuery.message.message_id)
          .catch((error) =>
            handleEditMessageError(error, "Не удалось удалить сообщение с прямым приглашением")
          );
        if (messageId) {
          bot
            .editMessageText(messages.directCancelled({ from: player1, to: invited }), {
              inline_message_id: messageId,
              reply_markup: { inline_keyboard: [] },
            })
            .catch((error) =>
              handleEditMessageError(
                error,
                "Не удалось обновить inline сообщение после удаления прямого приглашения"
              )
            );
        }
      } else {
        bot
          .editMessageText(messages.directCancelled({ from: player1, to: invited }), {
            ...editTarget,
          })
          .catch((error) =>
            handleEditMessageError(error, "Не удалось обновить сообщение об отмене прямого приглашения")
          );
      }
    } else if (parsed.type === "inline_test") {
      if (!isTestFeatureEnabled) {
        bot
          .answerCallbackQuery(callbackId, {
            text: ui.callback.testModeDisabled,
            show_alert: true,
          })
          .catch(console.error);
        return;
      }

      const count = parsed.count || 1;
      log.info("Создание тестовых матчей через callback inline_test", {
        user: player2,
        count,
        chatId,
      });

      const { created, failed } = await createTestMatches(chatId, count);
      const summaryText = formatTestSummary(created);

      if (messageId) {
        bot
          .editMessageText(summaryText, { inline_message_id: messageId })
          .catch((error) =>
            handleEditMessageError(error, "Не удалось обновить inline сообщение о тестовых матчах (callback)")
          );
      } else {
        bot
          .answerCallbackQuery(callbackId, { text: summaryText, show_alert: true })
          .catch(console.error);
      }

      if (failed.length > 0) {
        log.warn("Не все тестовые матчи были созданы (callback inline_test)", { failed });
      } else {
        log.info("Тестовые матчи созданы через callback inline_test", { count: created.length });
      }
    }
  });

  bot.on("polling_error", (error) => {
    log.error("Ошибка polling", { message: error.message });
  });

  return { bot, getContext };
};

export { createBot };

