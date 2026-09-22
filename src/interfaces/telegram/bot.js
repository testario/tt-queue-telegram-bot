import TelegramApi from "node-telegram-bot-api";
import {
  buildSearchInlineKeyboard as buildSearchKeyboardFn,
  buildMatchCancelKeyboard as buildMatchCancelKeyboardFn,
  buildDirectInviteKeyboard as buildDirectInviteKeyboardFn,
  buildDirectInviteRecipientKeyboard as buildDirectInviteRecipientKeyboardFn,
  buildDirectInviteInitiatorKeyboard as buildDirectInviteInitiatorKeyboardFn,
} from "#interfaces/telegram/keyboards.js";
import {
  DEFAULT_GAME_TIME,
  PAUSE_CANCEL_MATCH_MS,
  REGISTRATION_CONFIRMED_TTL_MS,
  TIME_AFTER_EMERGE,
  TIME_READY,
  WORK_SCHEDULE,
} from "#application/config/time.js";
import { createLogger } from "#infrastructure/logger/Logger.js";
import { QueueService } from "#domain/services/QueueService.js";
import { InMemoryQueueRepository } from "#infrastructure/repositories/InMemoryQueueRepository.js";
import { InMemoryPlayersRepository } from "#infrastructure/players/InMemoryPlayersRepository.js";
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
import { ClaimPlayerIdentity } from "#application/usecases/ClaimPlayerIdentity.js";
import { createTestIdentityHelper } from "#application/usecases/createTestIdentityHelper.js";
import { GetQueue } from "#application/usecases/GetQueue.js";
import { GetPlayed } from "#application/usecases/GetPlayed.js";
import { parseCallbackData } from "#application/parsers/callbackData.js";
import {
  updateQueueState,
  QueueStateConflictError,
} from "#application/usecases/queueStateCas.js";
import { UsageMetricsService } from "#application/services/UsageMetricsService.js";
import { MongoUsageMetricsRepository } from "#infrastructure/metrics/MongoUsageMetricsRepository.js";
import { InMemoryInvitesStore } from "#infrastructure/invites/InMemoryInvitesStore.js";
import { Match } from "#domain";
import { QueueState } from "#domain/entities/QueueState.js";
import { sendDirectInviteNotification } from "#interfaces/telegram/directInviteNotification.js";

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
 * @param {{ logger?: Logger, locale?: string, metricsEnabled?: boolean, invitesStore?: object }} [options]
 * @returns {TelegramApi}
 */
const createBot = (
  token,
  {
    logger,
    locale,
    metricsEnabled = false,
    playersRepository = null,
    queueRepository = null,
    eventBus = null,
    invitesStore = null,
    lifecycleManagedExternally = false,
    onQueueChanged = null,
    autoStartPolling = true,
    onDispose: initialDisposeHandler = null,
    onStop: ownerShutdown = null,
  } = {}
) => {
  const { messages: rawMessages, ui, locale: currentLocale } = createLocalization({
    ...I18N_CONFIG,
    locale: locale || I18N_CONFIG.locale,
  });
  const log = logger || createLogger({ prefix: "bot" });
  const directInvitesStore = invitesStore || new InMemoryInvitesStore();
  const identityRepository = playersRepository || new InMemoryPlayersRepository();
  const playerDisplayNames = new Map();

  const composeDisplayName = ({ username, firstName, lastName }) => {
    if (!username) return "";
    const handle = `@${username}`;
    const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
    return fullName ? `${handle} (${fullName})` : handle;
  };

  const rememberUserDisplayName = async (user, identityToken = null) => {
    const username = user?.username;
    if (!username) return null;
    const displayName = composeDisplayName({
      username,
      firstName: user?.first_name,
      lastName: user?.last_name,
    });
    const key = `@${username}`;
    if (identityToken) user.identityToken = identityToken;
    playerDisplayNames.set(key, displayName);
    return displayName;
  };

  const formatPlayerForMessage = (player) => playerDisplayNames.get(player) || player;

  const formatMatchForMessage = (match) =>
    match
      ? {
          ...match,
          player1: formatPlayerForMessage(match.player1),
          player2: formatPlayerForMessage(match.player2),
        }
      : match;

  const messages = createMessagesWithDisplay(rawMessages);
  log.info("Инициализация бота", { locale: currentLocale });
  const contexts = new Map();
  const queueChatId = process.env.TG_CHAT_ID ? String(process.env.TG_CHAT_ID) : null;
  const metricsChatId = process.env.METRICS_CHAT_ID ? String(process.env.METRICS_CHAT_ID) : null;
  const metricsUri = metricsEnabled ? process.env.METRICS_MONGODB_URI || process.env.MONGODB_URI || null : null;
  const metricsDb = metricsEnabled
    ? process.env.METRICS_MONGODB_DB || process.env.MONGODB_DB || "tt-queue-bot"
    : null;
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

  if (!metricsEnabled) {
    log.info("Метрики отключены: режим не включен", { flag: "--metrics" });
  } else if (!metricsRepository) {
    log.warn("Метрики отключены: нет строки подключения к MongoDB");
  }

  if (!queueChatId) {
    log.warn("TG_CHAT_ID не задан: бот не привязан к чату");
  }

  const usageMetrics = new UsageMetricsService({
    repository: metricsRepository,
    logger: log.child("service:metrics"),
  });

  /**
   * Возвращает chatId настроенного чата или null, если он не задан.
   * @param {number|string|null} [incomingChatId]
   * @returns {number|string|null}
   */
  const resolveQueueChatId = (incomingChatId = null) => {
    if (!queueChatId) return null;
    if (incomingChatId === null || incomingChatId === undefined) return queueChatId;
    return String(incomingChatId) === queueChatId ? queueChatId : null;
  };

  /**
   * Извлекает chatId из входящего сообщения, учитывая заданный чат.
   * @param {import("node-telegram-bot-api").Message} message
   * @returns {number|string|null}
   */
  const resolveChatIdFromMessage = (message) => resolveQueueChatId(message?.chat?.id);

  /**
   * Извлекает chatId из callback-запроса (для inline используем настроенный чат).
   * @param {import("node-telegram-bot-api").CallbackQuery} callbackQuery
   * @returns {number|string|null}
   */
  const resolveChatIdFromCallback = (callbackQuery) => {
    const messageChatId = callbackQuery?.message?.chat?.id;
    if (messageChatId !== null && messageChatId !== undefined) {
      const isDirectInvite = /^(direct_accept|direct_decline|direct_cancel):/.test(
        callbackQuery?.data || ""
      );
      return isDirectInvite ? resolveQueueChatId() : resolveQueueChatId(messageChatId);
    }
    return resolveQueueChatId();
  };

  /**
   * Возвращает chatId настроенного чата для inline-операций.
   * @returns {number|string|null}
   */
  const resolveChatIdFromUser = () => resolveQueueChatId();

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

  const EMERGE_RESUME_MIN_MS = TIME_AFTER_EMERGE;
  const emergeStateByChat = new Map();

  const buildMatchKey = (match) =>
    match ? `${match.player1}:${match.player2}:${match.startDate.getTime()}` : null;

  const shouldKeepMatchOnPause = (match, now) => {
    if (!match || match.status !== Match.statuses.playing) return false;
    const elapsedMs = now.getTime() - match.startDate.getTime();
    return elapsedMs >= PAUSE_CANCEL_MATCH_MS;
  };

  const shouldHoldMatch = (chatId, match, now) =>
    isPauseModeEnabled(chatId) && !shouldKeepMatchOnPause(match, now);

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
    if (resultId === "emerge") return { category: "admin", variant: "emerge" };
    if (resultId === "1") return { category: "preset", variant: "search" };
    if (resultId === "2") return { category: "preset", variant: "queue" };
    if (resultId === "3") return { category: "preset", variant: "played" };
    if (resultId.startsWith("test:")) return { category: "test", variant: "test" };
    return { category: "other", variant: "other" };
  };

  const pollingOptions = {
    autoStart: false,
    interval: 300,
    params: {
      timeout: 30,
      // Явно указываем нужные апдейты, чтобы получать chosen_inline_result
      allowed_updates: ["inline_query", "chosen_inline_result", "callback_query", "message"],
    },
  };

  const bot = new TelegramApi(token, {
    polling: pollingOptions,
  });

  const startLongPolling = async () => {
    if (isStopped) return;
    try {
      await bot.deleteWebHook();
      log.info("Webhook отключен перед запуском long polling");
    } catch (error) {
      log.error("Не удалось отключить webhook перед запуском long polling", {
        message: error.message,
      });
    }

    try {
      await bot.startPolling();
      log.info("Бот запущен в режиме long polling", {
        timeoutSeconds: pollingOptions.params.timeout,
      });
    } catch (error) {
      log.error("Не удалось запустить long polling", { message: error.message });
    }
  };

  const chatSlashCommands = [
    { command: "play", description: ui.commands.play },
    { command: "search", description: ui.commands.search },
    { command: "queue", description: ui.commands.queue },
    { command: "played", description: ui.commands.played },
    { command: "pause", description: ui.commands.pause },
    { command: "continue", description: ui.commands.continue },
    { command: "emerge", description: ui.commands.emerge },
  ];

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

  const playerBannedMessage = "Доступ запрещён: вы заблокированы администратором.";
  const playerStatusUnavailableMessage = "Не удалось проверить доступ, попробуйте позже.";

  const isPlayerBanned = async (user) => {
    if (!playersRepository) return false;
    if (typeof playersRepository.isBanned === "function" && user?.id != null) {
      return playersRepository.isBanned(user.id);
    }
    if (typeof playersRepository.findByUserId === "function" && user?.id != null) {
      const player = await playersRepository.findByUserId(user.id);
      return player?.banned === true;
    }
    if (typeof playersRepository.findOne === "function" && user?.username) {
      const player = await playersRepository.findOne(`@${user.username}`);
      return player?.banned === true;
    }
    return false;
  };

  const isInviteParticipantAuthorized = async (invite, actor, actorUserId, role) => {
    const identity = role === "initiator" ? invite?.playerIdentity : invite?.opponentIdentity;
    return Boolean(identity?.username === actor
      && identity.userId != null
      && String(identity.userId) === String(actorUserId));
  };

  const isInviteParticipantBanned = async (invite, role) => {
    const identity = role === "initiator" ? invite?.playerIdentity : invite?.opponentIdentity;
    if (identity?.userId == null) return true;
    return isPlayerBanned({ id: identity.userId });
  };

  /**
   * Проверяет бан до выполнения пользовательского действия.
   * Служебные уведомления сюда не попадают: у них нет пользователя.
   */
  const ensurePlayerNotBanned = async ({
    user,
    chatId = null,
    replyToMessageId = undefined,
    callbackId = undefined,
    inlineMessageId = undefined,
    inlineQueryId = undefined,
  }) => {
    const username = user?.username;
    if (!playersRepository || (user?.id == null && !username)) return true;

    let player;
    try {
      player = { banned: await isPlayerBanned(user) };
    } catch (error) {
      log.error("Не удалось проверить бан игрока в Telegram", {
        userId: user?.id,
        username: username ? `@${username}` : undefined,
        message: error.message,
      });
      if (callbackId) {
        await bot.answerCallbackQuery(callbackId, { text: playerStatusUnavailableMessage, show_alert: true }).catch(console.error);
      } else if (inlineQueryId) {
        await bot.answerInlineQuery(inlineQueryId, [], { cache_time: 1, is_personal: true }).catch(console.error);
      } else if (chatId) {
        await bot.sendMessage(chatId, playerStatusUnavailableMessage).catch(console.error);
      }
      return false;
    }

    if (player?.banned !== true) return true;

    if (callbackId) {
      await bot.answerCallbackQuery(callbackId, { text: playerBannedMessage, show_alert: true }).catch(console.error);
    } else if (inlineQueryId) {
      await bot.answerInlineQuery(
        inlineQueryId,
        [{
          type: "article",
          id: "player_banned",
          title: playerBannedMessage,
          input_message_content: { message_text: playerBannedMessage },
        }],
        { cache_time: 1, is_personal: true }
      ).catch(console.error);
    } else if (inlineMessageId) {
      await bot.editMessageText(playerBannedMessage, { inline_message_id: inlineMessageId }).catch((error) =>
        handleEditMessageError(error, "Не удалось показать сообщение о блокировке inline пользователя")
      );
    } else if (chatId) {
      await bot.sendMessage(
        chatId,
        playerBannedMessage,
        replyToMessageId ? { reply_to_message_id: replyToMessageId } : undefined
      ).catch(console.error);
    }
    return false;
  };

  const ensureUserRegistered = async ({
    user,
    chatId = null,
    replyToMessageId = undefined,
    callbackId = undefined,
    inlineMessageId = undefined,
    inlineQueryId = undefined,
  }) => {
    const reportRegistrationUnavailable = async () => {
      if (callbackId) {
        await bot.answerCallbackQuery(callbackId, {
          text: playerStatusUnavailableMessage,
          show_alert: true,
        }).catch(console.error);
      } else if (inlineQueryId) {
        await bot.answerInlineQuery(inlineQueryId, [], { cache_time: 1, is_personal: true }).catch(console.error);
      } else if (inlineMessageId) {
        await bot.editMessageText(playerStatusUnavailableMessage, {
          inline_message_id: inlineMessageId,
          reply_markup: { inline_keyboard: [] },
        }).catch((editError) => handleEditMessageError(editError, "Не удалось показать ошибку регистрации inline"));
      } else if (chatId) {
        await bot.sendMessage(chatId, playerStatusUnavailableMessage, replyToMessageId
          ? { reply_to_message_id: replyToMessageId }
          : undefined).catch(console.error);
      }
      return false;
    };

    try {
      if (user?.id == null) {
        await rememberUserDisplayName(user);
        return true;
      }
      const identityContext = getContext(queueChatId || chatId);
      if (!identityContext?.claimPlayerIdentity) throw new Error("identity claim context unavailable");
      const identityToken = await identityContext.claimPlayerIdentity.execute({
        username: user?.username ? `@${user.username}` : null,
        userId: user?.id,
        firstName: user?.first_name,
        lastName: user?.last_name,
      });
      if (identityToken?.transitions?.length) {
        const cleanupSucceeded = await cleanupPlayerIdentityTransition(identityToken.transitions);
        if (!cleanupSucceeded) return reportRegistrationUnavailable();
      }
      await rememberUserDisplayName(user, identityToken);
      return true;
    } catch (error) {
      log.error("Пользовательское действие остановлено: регистрация не завершена", {
        userId: user?.id,
        username: user?.username ? `@${user.username}` : undefined,
        message: error.message,
      });
      // Reserve already fenced the previous tuple. If persistence or
      // activation then fails, remove only references carrying that exact
      // immutable identity instead of touching a reused username.
      if (error?.transitions?.length) {
        const cleanupSucceeded = await cleanupPlayerIdentityTransition(error.transitions);
        if (!cleanupSucceeded) return reportRegistrationUnavailable();
      }
      if (error.reason === "player_banned") {
        return ensurePlayerNotBanned({
          user,
          chatId,
          replyToMessageId,
          callbackId,
          inlineMessageId,
          inlineQueryId,
        });
      }
      return reportRegistrationUnavailable();
    }
  };

  let isStopped = false;
  let stopCommandStarted = false;
  let disposePromise = null;
  const disposeHandlers = new Set();
  if (typeof initialDisposeHandler === "function") {
    disposeHandlers.add(initialDisposeHandler);
  }

  const onDispose = (handler) => {
    if (typeof handler !== "function") return () => {};
    if (disposePromise) {
      void disposePromise.then(() => handler()).catch((error) =>
        log.error("Ошибка dispose-handler", { message: error.message })
      );
      return () => {};
    }
    disposeHandlers.add(handler);
    return () => disposeHandlers.delete(handler);
  };

  const dispose = async () => {
    if (disposePromise) return disposePromise;
    disposePromise = (async () => {
      isStopped = true;
      try {
        await bot.stopPolling();
        log.info("Polling остановлен");
      } catch (error) {
        log.error("Ошибка остановки polling", { message: error.message });
      }

      for (const handler of disposeHandlers) {
        try {
          await handler();
        } catch (error) {
          log.error("Ошибка dispose-handler", { message: error.message });
        }
      }
      disposeHandlers.clear();

      for (const context of contexts.values()) {
        try {
          context.orchestrator.cancelAll();
        } catch (error) {
          log.error("Ошибка при отмене таймеров", {
            chatId: context.chatId,
            message: error.message,
          });
        }
      }
      for (const context of contexts.values()) {
        if (typeof context.orchestrator.dispose !== "function") continue;
        try {
          await context.orchestrator.dispose();
        } catch (error) {
          log.error("Ошибка drain lifecycle таймеров", {
            chatId: context.chatId,
            message: error.message,
          });
        }
      }
    })();
    return disposePromise;
  };
  const MAX_TEST_MATCHES = 10;
  const isTestFeatureEnabled = process.env.ENABLE_TEST_FEATURE === "true";

  bot.onText(/^\/start(?:@[\w_]+)?/, async (msg) => {
    if (!(await ensureUserRegistered({ user: msg.from, chatId: msg.chat?.id }))) return;
    trackUsage("command:start");

    if (!msg.chat?.id) return;

    if (!(await ensurePlayerNotBanned({ user: msg.from, chatId: msg.chat.id }))) return;

    try {
      await bot.sendMessage(msg.chat.id, messages.greet());
    } catch (error) {
      log.error("Не удалось отправить приветствие по /start", {
        chatId: msg.chat.id,
        message: error.message,
      });
    }
  });

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

  function createMessagesWithDisplay(baseMessages) {
    return {
      ...baseMessages,
      searchAdded: (player) => baseMessages.searchAdded(formatPlayerForMessage(player)),
      searchAccepted: (player) => baseMessages.searchAccepted(formatPlayerForMessage(player)),
      searchAlready: (player) => baseMessages.searchAlready(formatPlayerForMessage(player)),
      searchInQueue: (player) => baseMessages.searchInQueue(formatPlayerForMessage(player)),
      searchPlayed: (player) => baseMessages.searchPlayed(formatPlayerForMessage(player)),
      searchUnknown: (player) => baseMessages.searchUnknown(formatPlayerForMessage(player)),
      directOpponentPlayed: (player) =>
        baseMessages.directOpponentPlayed(formatPlayerForMessage(player)),
      directOpponentInvitePending: (player) =>
        baseMessages.directOpponentInvitePending(formatPlayerForMessage(player)),
      directInvite: ({ from, to }) =>
        baseMessages.directInvite({
          from: formatPlayerForMessage(from),
          to: formatPlayerForMessage(to),
        }),
      directInviteSent: ({ from, to }) =>
        baseMessages.directInviteSent({
          from: formatPlayerForMessage(from),
          to: formatPlayerForMessage(to),
        }),
      directAccepted: ({ from, to }) =>
        baseMessages.directAccepted({
          from: formatPlayerForMessage(from),
          to: formatPlayerForMessage(to),
        }),
      directDeclined: ({ from, to }) =>
        baseMessages.directDeclined({
          from: formatPlayerForMessage(from),
          to: formatPlayerForMessage(to),
        }),
      directCancelled: ({ from, to }) =>
        baseMessages.directCancelled({
          from: formatPlayerForMessage(from),
          to: formatPlayerForMessage(to),
        }),
      matchCreated: (match) => baseMessages.matchCreated(formatMatchForMessage(match)),
      nextPair: (match) => baseMessages.nextPair(formatMatchForMessage(match)),
      matchStarted: (match) => baseMessages.matchStarted(formatMatchForMessage(match)),
      matchFinished: (match) => baseMessages.matchFinished(formatMatchForMessage(match)),
      matchFinishedWithNext: ({ finished, next }) =>
        baseMessages.matchFinishedWithNext({
          finished: formatMatchForMessage(finished),
          next: formatMatchForMessage(next),
        }),
      queueList: (queue) => baseMessages.queueList(queue.map(formatMatchForMessage)),
      playedList: (played) => baseMessages.playedList(played.map(formatPlayerForMessage)),
      cancelCurrent: (player) => baseMessages.cancelCurrent(formatPlayerForMessage(player)),
      cancelWaiting: (player) => baseMessages.cancelWaiting(formatPlayerForMessage(player)),
      pauseModeEnabled: ({ player1, player2, action }) =>
        baseMessages.pauseModeEnabled({
          player1: player1 ? formatPlayerForMessage(player1) : player1,
          player2: player2 ? formatPlayerForMessage(player2) : player2,
          action,
        }),
      pauseModeDisabled: ({ player1, player2, startDate }) =>
        baseMessages.pauseModeDisabled({
          player1: formatPlayerForMessage(player1),
          player2: formatPlayerForMessage(player2),
          startDate,
        }),
      pauseModeDisabledCurrent: ({ player1, player2, endDate }) =>
        baseMessages.pauseModeDisabledCurrent({
          player1: formatPlayerForMessage(player1),
          player2: formatPlayerForMessage(player2),
          endDate,
        }),
      emergePaused: ({ player1, player2 }) =>
        baseMessages.emergePaused({
          player1: formatPlayerForMessage(player1),
          player2: formatPlayerForMessage(player2),
        }),
      emergeResumed: ({ player1, player2, remainingMinutes }) =>
        baseMessages.emergeResumed({
          player1: formatPlayerForMessage(player1),
          player2: formatPlayerForMessage(player2),
          remainingMinutes,
        }),
      emergeTooLate: ({ player1, player2 }) =>
        baseMessages.emergeTooLate({
          player1: formatPlayerForMessage(player1),
          player2: formatPlayerForMessage(player2),
        }),
    };
  }

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
    const repository = (queueRepository && String(chatId) === String(queueChatId))
      ? queueRepository
      : new InMemoryQueueRepository(queueService.createInitialState());
    const notifier = new EventNotifier({
      eventBus: (eventBus && String(chatId) === String(queueChatId)) ? eventBus : null,
    });
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
      shouldHoldNextMatch: () => isPauseModeEnabled(chatId),
      logger: log.child(`service:orchestrator:${chatId}`),
    });

    const usecaseOrchestrator = lifecycleManagedExternally
      ? {
          scheduleLifecycle: () => {},
          scheduleFinish: () => {},
          cancelForMatch: (...args) => orchestrator.cancelForMatch(...args),
          cancelAll: (...args) => orchestrator.cancelAll(...args),
          handleMatchFinished: (...args) => orchestrator.handleMatchFinished(...args),
        }
      : orchestrator;

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
      orchestrator: usecaseOrchestrator,
      notifier,
      messages,
      clock,
      logger: log.child(`usecase:AddMatch:${chatId}`),
      invitesStore: directInvitesStore,
    });
    const directMatch = new CreateDirectMatch({
      registerSearch,
      repository,
      queueService,
      clock,
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
      orchestrator: usecaseOrchestrator,
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
    const claimPlayerIdentity = new ClaimPlayerIdentity({
      queueRepository: repository,
      playersRepository: identityRepository,
      logger: log.child(`usecase:ClaimPlayerIdentity:${chatId}`),
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
      claimPlayerIdentity,
      inlineMessageId: null,
    };

    notifier.onMessage(({ chatId: targetChatId, text, meta }) => {
      if (targetChatId !== chatId) return;
      onQueueChanged?.({ chatId, meta });
      // player_verified (и любой другой служебный тип без текста для чата,
      // как state_update) идёт сюда же за onQueueChanged-пробуждением, но не
      // должен долетать до sendMessage — иначе Telegram отвечает "message
      // text is empty" на пустой text.
      if (meta?.type === "state_update" || !text) return;

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

  async function cleanupPlayerIdentityTransition(identities) {
    try {
      for (const context of contexts.values()) {
        await updateQueueState({
          repository: context.repository,
          logger: log,
          operation: "identity_transition_cleanup",
          mutate: (state) => {
            let changed = false;
            for (const searchingPlayer of [...state.searching]) {
              const storedIdentity = state.searchingIdentities?.[searchingPlayer];
              const matches = identities.some((identity) =>
                storedIdentity?.username === identity?.username
                && String(storedIdentity?.userId) === String(identity?.userId)
                && Number(storedIdentity?.generation) === Number(identity?.generation)
              );
              if (matches) {
                state.removeStaleSearching(searchingPlayer, storedIdentity);
                changed = true;
              }
            }
            return { state, changed, save: changed };
          },
        });
      }
      if (typeof directInvitesStore.deleteByParticipant === "function") {
        await directInvitesStore.deleteByParticipant({
          identities,
        });
      }
      return true;
    } catch (error) {
      log.error("Не удалось очистить переход identity", {
        message: error.message,
      });
      return false;
    }
  }

  // Локальные обёртки вокруг импортированных builders — захватывают ui и log из замыкания
  const buildSearchInlineKeyboard = (player) => buildSearchKeyboardFn(player, ui);
  const buildMatchCancelKeyboard = (match) => buildMatchCancelKeyboardFn(match, ui, log);
  const buildDirectInviteKeyboard = (invite) => buildDirectInviteKeyboardFn(invite, ui);
  const buildDirectInviteRecipientKeyboard = (invite) => buildDirectInviteRecipientKeyboardFn(invite, ui);
  const buildDirectInviteInitiatorKeyboard = (invite) => buildDirectInviteInitiatorKeyboardFn(invite, ui);

  const notifyDirectInvite = (chatId, invite, text, fallbackOptions = {}) =>
    sendDirectInviteNotification({
      bot,
      playersRepository,
      invite,
      text,
      replyMarkup: buildDirectInviteKeyboard(invite),
      directReplyMarkup: buildDirectInviteRecipientKeyboard(invite),
      fallbackChatId: chatId,
      log,
      fallbackOptions,
    });

  const notifyDirectInviteInitiator = async (chatId, invite, replyToMessageId) => {
    // Прямое приглашение — личное дело двоих, в общий чат его не анонсируем.
    // Подтверждение отправляем инициатору в ЛС, чат — только запасной вариант.
    const text = messages.directInviteSent({ from: invite.player, to: invite.opponent });
    const replyMarkup = buildDirectInviteInitiatorKeyboard(invite);
    const initiatorUserId = invite.playerIdentity?.userId;

    if (initiatorUserId != null) {
      try {
        await bot.sendMessage(initiatorUserId, text, { reply_markup: replyMarkup });
        return;
      } catch (error) {
        log.warn("Не удалось отправить подтверждение прямого приглашения инициатору в ЛС", {
          chatId,
          reason: "direct_message_unavailable",
          message: error.message,
        });
      }
    } else {
      log.warn("У инициатора прямого приглашения отсутствует Telegram userId", {
        chatId,
        reason: "user_id_missing",
      });
    }

    try {
      await bot.sendMessage(chatId, text, {
        reply_to_message_id: replyToMessageId,
        reply_markup: replyMarkup,
      });
    } catch (error) {
      log.warn("Не удалось отправить подтверждение прямого приглашения инициатору", {
        chatId,
        message: error.message,
      });
    }
  };

  const answerStaleDirectInvite = (callbackId) =>
    bot
      .answerCallbackQuery(callbackId, {
        text: ui.callback.matchNotFound,
        show_alert: true,
      })
      .catch(console.error);

  const deleteDirectInvite = async (invite) => {
    try {
      if (invite?.inviteId && typeof directInvitesStore.deleteById === "function") {
        await directInvitesStore.deleteById(invite.inviteId);
      }
    } catch (error) {
      log.error("Не удалось удалить прямое приглашение", {
        inviteId: invite?.inviteId,
        message: error.message,
      });
    }
  };

  const createDirectInvite = async (context, player, opponentRaw, identityToken = undefined) => {
    const opponent = context.directMatch.normalizeOpponent(opponentRaw);
    if (!player || !opponent) return context.directMatch.execute(player, opponentRaw, { identityToken });
    // CreateDirectMatch.execute тоже это проверяет и остаётся источником
    // истины (этот путь и POST /api/direct идут через один и тот же execute)
    // — короткое замыкание здесь просто избавляет от бессмысленного создания
    // и немедленного отката self-инвайта в сторе ниже. Проверка до
    // identity-lookup — так же, как в POST /api/direct — чтобы reason не
    // зависел от того, есть ли у инициатора активная identity.
    if (opponent.toLowerCase() === player.toLowerCase()) {
      return { ok: false, reason: "self_invite", text: messages.directSelfInvite() };
    }
    const currentState = await context.repository.get();
    const opponentIdentity = typeof currentState.getActiveIdentity === "function"
      ? currentState.getActiveIdentity(opponent)
      : null;
    if (!QueueState.isCompleteIdentity(identityToken) || !opponentIdentity) {
      return { ok: false, reason: "identity_unavailable", text: playerStatusUnavailableMessage };
    }
    // У оппонента уже есть собственное исходящее приглашение — если он примет
    // наше, его приглашение осиротеет (тот же случай, что и с общим поиском:
    // его "поиск" на бэкенде держится именно тем приглашением). Тот же
    // guard стоит и в webapp-роуте POST /api/direct — оба пути пишут в одно
    // хранилище приглашений, поэтому дыру нужно закрывать в обоих местах.
    if (typeof directInvitesStore.getByPlayer === "function" && await directInvitesStore.getByPlayer(opponent)) {
      return { ok: false, reason: "opponent_invite_pending", text: messages.directOpponentInvitePending(opponent) };
    }
    const invite = await directInvitesStore.create({
      player,
      opponent,
      playerIdentity: identityToken,
      opponentIdentity,
      createdAt: Date.now(),
    });
    if (!invite) {
      return { ok: false, reason: "invite_exists", text: messages.matchAlreadyInQueue() };
    }

    try {
      const result = await context.directMatch.execute(player, opponent, { identityToken, opponentIdentity });
      if (!result.ok) await deleteDirectInvite(invite);
      if (result.ok) context.notifier.notify(context.chatId, "", { type: "state_update" });
      return result.ok ? { ...result, invite } : result;
    } catch (error) {
      await deleteDirectInvite(invite);
      throw error;
    }
  };

  const consumeDirectInvite = async (context, callbackId, inviteId, actor, actorUserId, role) => {
    if (!inviteId) {
      answerStaleDirectInvite(callbackId);
      return null;
    }

    try {
      const pending = typeof directInvitesStore.getById === "function"
        ? await directInvitesStore.getById(inviteId)
        : null;
      if (pending && !(await isInviteParticipantAuthorized(pending, actor, actorUserId, role))) {
        answerStaleDirectInvite(callbackId);
        return null;
      }
      const state = await context.repository.get();
      const identity = role === "initiator" ? pending?.playerIdentity : pending?.opponentIdentity;
      if (!pending || !state.isActiveIdentity?.(identity)
        || !QueueState.sameIdentity(state.getActiveIdentity?.(actor), identity)) {
        answerStaleDirectInvite(callbackId);
        return null;
      }
      const invite = await directInvitesStore.consume(inviteId, { actor, actorUserId, role });
      if (!invite) {
        answerStaleDirectInvite(callbackId);
      }
      return invite;
    } catch (error) {
      log.error("Не удалось обработать прямое приглашение", { message: error.message });
      bot
        .answerCallbackQuery(callbackId, {
          text: ui.callback.contextMissing,
          show_alert: true,
        })
        .catch(console.error);
      return null;
    }
  };

  const freezeQueueForPause = async (context) => {
    if (!context) return { hasQueue: false };
    const result = await updateQueueState({
      repository: context.repository,
      logger: log,
      operation: "bot_pause",
      mutate: (state) => {
        if (!state.queue.length) return { state, hasQueue: false, save: false };

        const now = context.clock.now();
        const currentMatch = state.queue[0];
        const shouldKeepCurrent = shouldKeepMatchOnPause(currentMatch, now);

        if (!shouldKeepCurrent) {
          state.queue.forEach((item) => {
            item.status = Match.statuses.waiting;
          });
        } else {
          state.queue.forEach((item, index) => {
            if (index > 0) {
              item.status = Match.statuses.waiting;
            }
          });
        }

        state.holdNextMatch = shouldKeepCurrent;
        context.queueService.recalculateWaiting(state);
        return {
          state,
          hasQueue: true,
          currentMatch,
          currentMatchContinues: shouldKeepCurrent,
        };
      },
    });

    onQueueChanged?.({ chatId: context.chatId, meta: { type: "state_update" } });

    if (!result.hasQueue) return { hasQueue: false };

    if (!result.currentMatchContinues) context.orchestrator.cancelAll();
    return {
      hasQueue: true,
      nextMatch: result.state.queue[0],
      currentMatch: result.currentMatch,
      currentMatchContinues: result.currentMatchContinues,
    };
  };

  const buildPauseModeEnabledMessage = (freezeResult) => {
    const hasCurrent = freezeResult?.currentMatch;
    if (hasCurrent && freezeResult.currentMatch.player1 && freezeResult.currentMatch.player2) {
      return messages.pauseModeEnabled({
        player1: freezeResult.currentMatch.player1,
        player2: freezeResult.currentMatch.player2,
        action: freezeResult.currentMatchContinues ? "continue" : "stop",
      });
    }
    return messages.pauseModeEnabled({ action: "none" });
  };

  const applyPauseMode = async ({
    chatId,
    context,
    username,
    replyToMessageId = undefined,
    inlineMessageId = undefined,
    source = "pause",
  }) => {
    let freezeResult;
    try {
      freezeResult = await freezeQueueForPause(context);
    } catch (error) {
      if (!(error instanceof QueueStateConflictError)) throw error;
      log.error("Не удалось включить режим паузы: исчерпаны попытки CAS", {
        chatId,
        username,
        source,
        message: error.message,
      });
      await respondEmergeMessage({
        chatId,
        text: ui.callback.actionFailed,
        replyToMessageId,
        inlineMessageId,
      });
      // Состояние не изменено из-за конкурирующей записи — вызывающая сторона
      // (например, /api/admin/pause) должна узнать об этом, а не решить, что
      // пауза включилась.
      return { hasQueue: false, conflict: true };
    }
    // Флаг паузы включаем независимо от того, есть ли сейчас очередь: он
    // управляет и планированием будущих матчей (scheduleLifecycle), а не
    // только заморозкой уже существующей очереди.
    setPauseMode(chatId, true);
    log.info("Режим паузы включен", {
      chatId,
      username,
      source,
      queueFrozen: freezeResult.hasQueue,
      currentMatchContinues: freezeResult.currentMatchContinues,
    });
    const pauseMessage = buildPauseModeEnabledMessage(freezeResult);
    await respondEmergeMessage({
      chatId,
      text: pauseMessage,
      replyToMessageId,
      inlineMessageId,
    });
    return { hasQueue: freezeResult.hasQueue };
  };

  const resumeQueueAfterPause = async (context) => {
    if (!context) return { hasQueue: false };
    const now = context.clock.now();
    let result;
    try {
      result = await updateQueueState({
        repository: context.repository,
        logger: log,
        operation: "bot_resume_queue",
        mutate: (state) => {
          if (!state.queue.length) return { state, hasQueue: false, save: false };
          const nextMatch = state.queue[0];
          const isCurrentPlaying =
            nextMatch.status === Match.statuses.playing && now >= nextMatch.startDate;
          if (isCurrentPlaying) {
            state.holdNextMatch = false;
            return {
              state,
              hasQueue: true,
              currentMatchContinues: true,
              currentMatch: nextMatch,
            };
          }
          nextMatch.status = Match.statuses.playing;
          nextMatch.startDate = new Date(now.getTime() + context.queueService.readyMs);
          nextMatch.endDate = new Date(nextMatch.startDate.getTime() + context.queueService.gameMs);
          state.holdNextMatch = false;
          context.queueService.recalculateWaiting(state);
          return { state, hasQueue: true, nextMatch };
        },
      });
    } catch (error) {
      if (!(error instanceof QueueStateConflictError)) throw error;
      log.error("Не удалось снять режим паузы: исчерпаны попытки CAS", {
        chatId: context.chatId,
        message: error.message,
      });
      return { hasQueue: false, conflict: true };
    }

    setPauseMode(context.chatId, false);
    onQueueChanged?.({ chatId: context.chatId, meta: { type: "state_update" } });

    if (!result.hasQueue) return { hasQueue: false };

    if (result.currentMatchContinues) {
      return { hasQueue: true, currentMatchContinues: true, currentMatch: result.currentMatch };
    }
    if (!lifecycleManagedExternally) context.orchestrator.scheduleLifecycle(result.nextMatch);
    return { hasQueue: true, nextMatch: result.nextMatch };
  };

  const notifyQueuePausedIfNeeded = async (chatId, replyToMessageId) => {
    if (!isPauseModeEnabled(chatId)) return;
    await bot.sendMessage(
      chatId,
      messages.pauseModeOnHold(),
      replyToMessageId ? { reply_to_message_id: replyToMessageId } : undefined
    );
  };

  const respondEmergeMessage = async ({
    chatId,
    text,
    replyToMessageId = undefined,
    inlineMessageId = undefined,
  }) => {
    if (inlineMessageId) {
      bot
        .editMessageText(text, { inline_message_id: inlineMessageId })
        .catch((error) =>
          handleEditMessageError(error, "Не удалось обновить inline сообщение /emerge")
        );
      return;
    }
    await bot.sendMessage(
      chatId,
      text,
      replyToMessageId ? { reply_to_message_id: replyToMessageId } : undefined
    );
  };

  const handleEmerge = async ({
    chatId,
    context,
    userId,
    replyToMessageId = undefined,
    inlineMessageId = undefined,
  }) => {
    if (!chatId || !context) return;
    const chatKey = normalizeChatKey(chatId);
    if (!chatKey) return;

    const isAdmin = await isUserAdmin(chatId, userId);
    if (!isAdmin) {
      await respondEmergeMessage({
        chatId,
        text: messages.adminOnly(),
        replyToMessageId,
        inlineMessageId,
      });
      return;
    }

    if (emergeStateByChat.has(chatKey)) {
      await respondEmergeMessage({
        chatId,
        text: messages.emergeAlreadyActive(),
        replyToMessageId,
        inlineMessageId,
      });
      return;
    }

    const state = await context.repository.get();
    const currentMatch = state.queue[0];
    const now = context.clock.now();
    const isMatchRunning =
      currentMatch &&
      currentMatch.status === Match.statuses.playing &&
      now >= currentMatch.startDate &&
      now < currentMatch.endDate;

    if (!isMatchRunning) {
      if (isPauseModeEnabled(chatId)) {
        await respondEmergeMessage({
          chatId,
          text: messages.emergePauseAlreadyEnabled(),
          replyToMessageId,
          inlineMessageId,
        });
        return;
      }
      await applyPauseMode({
        chatId,
        context,
        replyToMessageId,
        inlineMessageId,
        source: "emerge_as_pause",
      });
      return;
    }

    const remainingMs = Math.max(0, currentMatch.endDate.getTime() - now.getTime());

    context.orchestrator.cancelForMatch(currentMatch);
    emergeStateByChat.set(chatKey, {
      matchKey: buildMatchKey(currentMatch),
      remainingMs,
    });
    await respondEmergeMessage({
      chatId,
      text: messages.emergePaused({
        player1: currentMatch.player1,
        player2: currentMatch.player2,
      }),
      replyToMessageId,
      inlineMessageId,
    });
  };

  const resumeEmergeAfterContinue = async ({ chatId, context, replyToMessageId }) => {
    if (!chatId || !context) return { handled: false };
    const chatKey = normalizeChatKey(chatId);
    if (!chatKey) return { handled: false };

    const storedEmerge = emergeStateByChat.get(chatKey);
    if (!storedEmerge) return { handled: false };

    let result;
    try {
      result = await updateQueueState({
        repository: context.repository,
        logger: log,
        operation: "bot_resume_emerge",
        mutate: (state) => {
          const currentMatch = state.queue[0];
          if (!currentMatch || buildMatchKey(currentMatch) !== storedEmerge.matchKey) {
            return { state, save: false, stale: true };
          }
          if (storedEmerge.remainingMs <= EMERGE_RESUME_MIN_MS) {
            return { state, save: false, tooLate: true, currentMatch };
          }
          const now = context.clock.now();
          currentMatch.status = Match.statuses.playing;
          currentMatch.startDate = now;
          currentMatch.endDate = new Date(now.getTime() + storedEmerge.remainingMs);
          return { state, save: true, currentMatch };
        },
      });
    } catch (error) {
      if (!(error instanceof QueueStateConflictError)) throw error;
      log.error("Не удалось возобновить матч после emerge: исчерпаны попытки CAS", {
        chatId,
        message: error.message,
      });
      return { handled: false, conflict: true };
    }

    if (result.stale) {
      emergeStateByChat.delete(chatKey);
      await respondEmergeMessage({
        chatId,
        text: messages.emergeNotActive(),
        replyToMessageId,
      });
      return { handled: true };
    }

    if (result.tooLate) {
      emergeStateByChat.delete(chatKey);
      await respondEmergeMessage({
        chatId,
        text: messages.emergeTooLate({
          player1: result.currentMatch.player1,
          player2: result.currentMatch.player2,
        }),
        replyToMessageId,
      });
      await context.orchestrator.handleMatchFinished(result.currentMatch);
      return { handled: true };
    }

    emergeStateByChat.delete(chatKey);
    onQueueChanged?.({ chatId: context.chatId, meta: { type: "state_update" } });
    if (!lifecycleManagedExternally) context.orchestrator.scheduleFinish(result.currentMatch);

    await respondEmergeMessage({
      chatId,
      text: messages.emergeResumed({
        player1: result.currentMatch.player1,
        player2: result.currentMatch.player2,
        remainingMinutes: Math.ceil(storedEmerge.remainingMs / (60 * 1000)),
      }),
      replyToMessageId,
    });
    return { handled: true };
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
    const activateTestIdentity = createTestIdentityHelper({
      claimPlayerIdentity: context.claimPlayerIdentity,
    });
    const testCount = Math.min(count, MAX_TEST_MATCHES);
    const timestamp = Date.now();
    const created = [];
    const failed = [];

    for (let i = 0; i < testCount; i += 1) {
      const searcher = ui.test.playerName({ timestamp, index: i, suffix: "A" });
      const opponent = ui.test.playerName({ timestamp, index: i, suffix: "B" });
      const searcherIdentity = await activateTestIdentity({ username: searcher });
      const opponentIdentity = await activateTestIdentity({ username: opponent });

      await registerSearch.execute(searcher, searcherIdentity);
      const addResult = await addMatch.execute(searcher, opponent, {
        scheduleLifecycle: !isPauseModeEnabled(chatId),
        participantIdentities: {
          [searcher]: searcherIdentity,
          [opponent]: opponentIdentity,
        },
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
    if (isStopped || stopCommandStarted) {
      log.info("Получена повторная команда /stop, бот уже остановлен", { chatId, username });
      return;
    }
    stopCommandStarted = true;
    log.warn("Остановка бота по команде /stop", { chatId, username });
    try {
      await bot.sendMessage(chatId, messages.botStopped());
    } catch (error) {
      log.error("Не удалось отправить сообщение об остановке", { message: error.message });
    }
    if (typeof ownerShutdown === "function") {
      try {
        await ownerShutdown();
      } catch (error) {
        log.error("Ошибка owner-level shutdown по /stop", { message: error.message });
      }
    } else {
      await dispose();
    }
  };

  bot.onText(/\/stop/, async (msg) => {
    const chatId = resolveChatIdFromMessage(msg);
    const username = msg.from?.username;
    if (!chatId) {
      log.warn("Команда /stop вне основного чата", { username });
      return;
    }
    if (!(await ensureUserRegistered({ user: msg.from, chatId, replyToMessageId: msg.message_id }))) return;
    if (!(await ensurePlayerNotBanned({ user: msg.from, chatId, replyToMessageId: msg.message_id }))) return;
    trackUsage("command:stop");
    await stopBot(chatId, username);
  });

  bot.onText(/\/pause(?:@[\w_]+)?/, async (msg) => {
    const chatId = resolveChatIdFromMessage(msg);
    const userId = msg.from?.id;
    const username = msg.from?.username;
    if (!(await ensureUserRegistered({ user: msg.from, chatId, replyToMessageId: msg.message_id }))) return;

    trackUsage("command:pause");

    if (!chatId) {
      log.warn("Команда /pause без chatId", { userId, username });
      return;
    }
    if (!(await ensurePlayerNotBanned({ user: msg.from, chatId, replyToMessageId: msg.message_id }))) return;

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

    await applyPauseMode({
      chatId,
      context,
      username,
      replyToMessageId: msg.message_id,
      source: "pause_command",
    });
  });

  bot.onText(/\/continue(?:@[\w_]+)?/, async (msg) => {
    const chatId = resolveChatIdFromMessage(msg);
    const userId = msg.from?.id;
    const username = msg.from?.username;
    if (!(await ensureUserRegistered({ user: msg.from, chatId, replyToMessageId: msg.message_id }))) return;

    trackUsage("command:continue");

    if (!chatId) {
      log.warn("Команда /continue без chatId", { userId, username });
      return;
    }
    if (!(await ensurePlayerNotBanned({ user: msg.from, chatId, replyToMessageId: msg.message_id }))) return;

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

    const emergeResult = await resumeEmergeAfterContinue({
      chatId,
      context,
      replyToMessageId: msg.message_id,
    });
    if (emergeResult.conflict) {
      await bot.sendMessage(chatId, ui.callback.actionFailed, {
        reply_to_message_id: msg.message_id,
      });
      return;
    }
    const pauseEnabled = isPauseModeEnabled(chatId);

    if (!pauseEnabled && !emergeResult.handled) {
      await bot.sendMessage(chatId, messages.pauseModeNotEnabled(), {
        reply_to_message_id: msg.message_id,
      });
      return;
    }

    if (emergeResult.handled) {
      const queueText = await context.getQueue.execute();
      await bot.sendMessage(chatId, queueText, { reply_to_message_id: msg.message_id });
    }

    if (!pauseEnabled) {
      return;
    }

    const resumeResult = await resumeQueueAfterPause(context);
    log.info("Режим паузы выключен", {
      chatId,
      username,
      queueStarted: resumeResult.hasQueue,
      currentMatchContinues: resumeResult.currentMatchContinues,
    });

    if (resumeResult.conflict) {
      await bot.sendMessage(chatId, ui.callback.actionFailed, {
        reply_to_message_id: msg.message_id,
      });
      return;
    }

    if (!resumeResult.hasQueue) {
      await bot.sendMessage(chatId, messages.pauseModeDisabledNoQueue(), {
        reply_to_message_id: msg.message_id,
      });
      return;
    }

    if (resumeResult.currentMatchContinues) {
      const { currentMatch } = resumeResult;
      await bot.sendMessage(
        chatId,
        messages.pauseModeDisabledCurrent({
          player1: currentMatch.player1,
          player2: currentMatch.player2,
          endDate: currentMatch.endDate,
        }),
        { reply_to_message_id: msg.message_id }
      );
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

  bot.onText(/\/emerge(?:@[\w_]+)?/, async (msg) => {
    const chatId = resolveChatIdFromMessage(msg);
    const userId = msg.from?.id;
    const username = msg.from?.username;
    if (!(await ensureUserRegistered({ user: msg.from, chatId, replyToMessageId: msg.message_id }))) return;

    trackUsage("command:emerge");

    if (!chatId) {
      log.warn("Команда /emerge без chatId", { userId, username });
      return;
    }
    if (!(await ensurePlayerNotBanned({ user: msg.from, chatId, replyToMessageId: msg.message_id }))) return;

    const context = getContext(chatId);
    if (!context) {
      await bot.sendMessage(chatId, ui.callback.contextMissing);
      log.warn("Контекст не найден для команды /emerge", { chatId });
      return;
    }

    await handleEmerge({
      chatId,
      context,
      userId,
      replyToMessageId: msg.message_id,
    });
  });

  bot.onText(/\/metrics(?:@[\w_]+)?(?:\s+(.+))?/, async (msg, match) => {
    const chatId = resolveChatIdFromMessage(msg);
    const userId = msg.from?.id;
    if (!(await ensureUserRegistered({ user: msg.from, chatId, replyToMessageId: msg.message_id }))) return;
    if (!(await ensurePlayerNotBanned({ user: msg.from, chatId, replyToMessageId: msg.message_id }))) return;
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
    if (!(await ensureUserRegistered({ user: msg.from, chatId, replyToMessageId: msg.message_id }))) return;

    trackUsage("command:search");

    if (!chatId) {
      log.warn("Команда /search без chatId", { userId, username });
      return;
    }

    if (!player) {
      await bot.sendMessage(chatId, messages.usernameRequired());
      return;
    }
    if (!(await ensurePlayerNotBanned({ user: msg.from, chatId, replyToMessageId: msg.message_id }))) return;

    const context = getContext(chatId);
    if (!context) {
      await bot.sendMessage(chatId, ui.callback.contextMissing);
      log.warn("Контекст не найден для команды /search", { chatId });
      return;
    }

    try {
      const searchResult = await context.registerSearch.execute(player, msg.from.identityToken);
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
    if (!(await ensureUserRegistered({ user: msg.from, chatId, replyToMessageId: msg.message_id }))) return;

    trackUsage("command:queue");

    if (!chatId) {
      log.warn("Команда /queue без chatId", { userId, username });
      return;
    }
    if (!(await ensurePlayerNotBanned({ user: msg.from, chatId, replyToMessageId: msg.message_id }))) return;

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
    if (!(await ensureUserRegistered({ user: msg.from, chatId, replyToMessageId: msg.message_id }))) return;

    trackUsage("command:played");

    if (!chatId) {
      log.warn("Команда /played без chatId", { userId, username });
      return;
    }
    if (!(await ensurePlayerNotBanned({ user: msg.from, chatId, replyToMessageId: msg.message_id }))) return;

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
    if (!(await ensureUserRegistered({ user: msg.from, chatId, replyToMessageId: msg.message_id }))) return;
    const opponentRaw = (match && match[1]) || "";

    trackUsage("command:play", { hasOpponent: Boolean(opponentRaw.trim()) });

    if (!chatId) {
      log.warn("Команда /play без chatId", { userId, username });
      return;
    }
    if (!(await ensurePlayerNotBanned({ user: msg.from, chatId, replyToMessageId: msg.message_id }))) return;

    const context = getContext(chatId);
    if (!context) {
      bot
        .sendMessage(chatId, ui.callback.contextMissing)
        .catch((error) => log.error("Не удалось отправить ответ о контексте для /play", { message: error.message }));
      log.warn("Контекст не найден для команды /play", { chatId });
      return;
    }

    log.info("Получена команда /play", { chatId, player, opponentRaw });

    try {
      const result = await createDirectInvite(context, player, opponentRaw, msg.from.identityToken);
      trackUsage("usecase:direct_match", { ok: result.ok, reason: result.reason });
      if (!result.ok) {
        await bot.sendMessage(chatId, result.text, {
          reply_to_message_id: msg.message_id,
        });
        return;
      }

      const { invite } = result;
      const delivery = await notifyDirectInvite(chatId, invite, result.text, {
        reply_to_message_id: msg.message_id,
      });
      if (delivery?.sentDirect) await notifyDirectInviteInitiator(chatId, invite, msg.message_id);
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
    const chatId = resolveChatIdFromUser();
    if (!(await ensureUserRegistered({ user: query.from, inlineQueryId: query.id }))) return;
    if (!(await ensurePlayerNotBanned({ user: query.from, inlineQueryId: query.id }))) return;
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
      {
        type: "article",
        id: "emerge",
        title: ui.inline.emerge.title,
        input_message_content: {
          message_text: ui.inline.emerge.text,
        },
        description: ui.inline.emerge.description,
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
    const chatId = resolveChatIdFromUser();
    if (!(await ensureUserRegistered({ user: result.from, inlineMessageId: result.inline_message_id }))) return;
    if (!(await ensurePlayerNotBanned({ user: result.from, chatId, inlineMessageId: result.inline_message_id }))) return;
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
    if (resultId === "1") {
      try {
        const searchResult = await registerSearch.execute(player, result.from.identityToken);
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
    } else if (resultId === "emerge") {
      trackUsage("inline:emerge");
      await handleEmerge({ chatId, context, userId, inlineMessageId });
    } else if (resultId?.startsWith("direct:")) {
      const opponentRaw = decodeURIComponent(resultId.replace("direct:", ""));
      let directResult;
      try {
        directResult = await createDirectInvite(context, player, opponentRaw, result.from.identityToken);
      } catch (error) {
        log.error("Ошибка создания прямого приглашения из inline", { message: error.message });
        if (inlineMessageId) {
          bot
            .editMessageText(ui.callback.contextMissing, { inline_message_id: inlineMessageId })
            .catch((editError) => handleEditMessageError(editError, "Не удалось показать ошибку inline direct"));
        }
        return;
      }

      // Всегда отправляем приглашение в общий чат
      const sendInvite = (text, invite) =>
        invite && invite.player && invite.opponent
          ? notifyDirectInvite(chatId, invite, text)
          : bot.sendMessage(chatId, text, { reply_markup: undefined });

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
      const delivery = await sendInvite(directResult.text, invite);

      if (inlineMessageId) {
        const editText = delivery?.sentDirect
          ? messages.directInviteSent({ from: invite.player, to: invite.opponent })
          : directResult.text;
        const editOptions = delivery?.sentDirect
          ? {
              inline_message_id: inlineMessageId,
              reply_markup: buildDirectInviteInitiatorKeyboard(invite),
            }
          : { inline_message_id: inlineMessageId, reply_markup: { inline_keyboard: [] } };
        bot
          .editMessageText(editText, editOptions)
          .catch((error) =>
            handleEditMessageError(error, "Не удалось обновить inline сообщение после отправки приглашения")
          );
      } else if (delivery?.sentDirect) {
        await notifyDirectInviteInitiator(chatId, invite);
      }
    }
  });

  const handleCallbackQuery = async (callbackQuery) => {
    const callbackId = callbackQuery.id;
    const messageId = callbackQuery.inline_message_id;
    const player2 = "@" + callbackQuery.from.username;
    const chatId = resolveChatIdFromCallback(callbackQuery);
    if (!(await ensureUserRegistered({
      user: callbackQuery.from,
      chatId,
      callbackId,
      inlineMessageId: callbackQuery.inline_message_id,
    }))) return;
    const userId = callbackQuery.from?.id;
    if (!(await ensurePlayerNotBanned({ user: callbackQuery.from, callbackId }))) return;
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
    const { addMatch, cancelSearch, cancelMatch } = context;
    const parsed = parseCallbackData(callbackQuery.data || "");
    log.info("Обработка callback", { type: parsed.type, player: player2, chatId });
    trackUsage(`callback:${parsed.type || "unknown"}`, {
      hasMessageId: Boolean(messageId),
    });

    const editTarget =
      messageId != null
        ? { inline_message_id: messageId }
        : callbackQuery.message?.message_id != null
        ? {
            chat_id: callbackQuery.message.chat?.id ?? chatId,
            message_id: callbackQuery.message.message_id,
          }
        : null;
    const buildEditOptions = (extra = {}) => (editTarget ? { ...editTarget, ...extra } : null);
    const queueReplyMessageId =
      callbackQuery.message?.chat?.id != null
        && String(callbackQuery.message.chat.id) === String(queueChatId)
        ? callbackQuery.message.message_id
        : undefined;

    if (parsed.type === "play_with") {
      const player1 = parsed.player;
      const currentState = await context.repository.get();
      const player1Identity = currentState.searchingIdentities?.[player1];
      const player2Identity = callbackQuery.from.identityToken;
      const player1Banned = player1Identity?.userId != null
        && await isPlayerBanned({ id: player1Identity.userId });
      const player2Banned = player2Identity?.userId != null
        && await isPlayerBanned({ id: player2Identity.userId });
      if (player1Banned || player2Banned) {
        await bot.answerCallbackQuery(callbackId, { text: playerBannedMessage, show_alert: true }).catch(console.error);
        return;
      }
      const addResult = await addMatch.execute(player1, player2, {
        scheduleLifecycle: !isPauseModeEnabled(chatId),
        participantIdentities: {
          [player1]: player1Identity,
          [player2]: player2Identity,
        },
      });
      if (addResult.ok) {
        log.info("Матч принят через callback", { player1, player2 });
        const editOptions = buildEditOptions({
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
        });
        if (editOptions) {
          bot
            .editMessageText(messages.searchAccepted(player2), editOptions)
            .catch((error) =>
              handleEditMessageError(error, "Не удалось обновить сообщение подтверждения матча")
            );
        } else {
          log.warn("Нет цели для редактирования сообщения подтверждения матча", {
            chatId,
            player1,
            player2,
          });
        }
        await notifyQueuePausedIfNeeded(chatId, queueReplyMessageId);
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
      const cancelResult = await cancelSearch.execute(parsed.player, callbackQuery.from.identityToken);
      if (cancelResult.status === "removed") {
        // Игрок передумал: анонс "хочет поиграть" убираем без комментариев.
        // Inline-сообщения удалить нельзя — их можно только отредактировать.
        if (editTarget?.inline_message_id) {
          bot
            .editMessageText(
              messages.searchCancelled(),
              buildEditOptions({ reply_markup: { inline_keyboard: [] } })
            )
            .catch((error) =>
              handleEditMessageError(error, "Не удалось обновить inline сообщение об отмене поиска")
            );
        } else if (editTarget) {
          bot
            .deleteMessage(editTarget.chat_id, editTarget.message_id)
            .catch((error) => {
              log.error("Не удалось удалить сообщение об отмене поиска", { message: error.message });
              bot
                .editMessageText(
                  messages.searchCancelled(),
                  buildEditOptions({ reply_markup: { inline_keyboard: [] } })
                )
                .catch((editError) =>
                  handleEditMessageError(
                    editError,
                    "Не удалось обновить сообщение об отмене поиска после неудачного удаления"
                  )
                );
            });
        } else {
          log.warn("Нет цели для удаления сообщения об отмене поиска", {
            chatId,
            player: parsed.player,
          });
          bot
            .answerCallbackQuery(callbackId, { text: messages.searchCancelled() })
            .catch(console.error);
        }
      } else {
        context.notifier.notify(context.chatId, "", { type: "state_update" });
        bot
          .answerCallbackQuery(callbackId, {
            text: ui.callback.cancelAlreadyRemoved,
            show_alert: true,
          })
          .catch(console.error);
      }
    } else if (parsed.type === "confirm_player") {
      // Идентичность нажавшего берём из callbackQuery.from.id (реальный,
      // неподделываемый userId от Telegram), а не из payload — сверяем с тем,
      // что закодировано в callback_data. userId, а не username (как в
      // cancel_search выше): не меняется при смене ника игроком между
      // отправкой сообщения в чат и нажатием кнопки.
      if (!parsed.userId || String(userId) !== String(parsed.userId)) {
        log.warn("Попытка подтвердить чужую регистрацию", { requester: userId, target: parsed.userId });
        bot
          .answerCallbackQuery(callbackId, {
            text: ui.callback.confirmRegistrationNotAuthor,
            show_alert: true,
          })
          .catch(console.error);
        return;
      }

      const player = await identityRepository.findByUserId(userId);
      if (!player) {
        // Не должно происходить: POST /api/register (auth() preHandler)
        // всегда апсертит запись игрока до отправки этого сообщения.
        // Защитная ветка на случай гонки/ручного вызова.
        bot.answerCallbackQuery(callbackId, { text: ui.callback.contextMissing, show_alert: true }).catch(console.error);
        return;
      }

      // Двойное нажатие до того, как Telegram успеет убрать кнопку из
      // сообщения (или повторный тап после уже обработанного) — идемпотентно:
      // просто подтверждаем ещё раз тем же текстом, без повторной записи и
      // без повторной публикации player_verified в Redis.
      if (player.verified !== true) {
        await identityRepository.setVerified(player.username, true);
        // Кросс-процессный релей в backend-процесс: там SSE подключение к
        // мини-аппу (если открыто) узнаёт об этом мгновенно, см.
        // src/interfaces/webapp/index.js.
        context.notifier.notify(context.chatId, "", { type: "player_verified", userId: String(userId) });
      }

      bot.answerCallbackQuery(callbackId, { text: messages.registrationConfirmed() }).catch(console.error);
      const editOptions = buildEditOptions({ reply_markup: { inline_keyboard: [] } });
      if (editOptions) {
        bot.editMessageText(messages.registrationConfirmed(), editOptions).then(
          () => {
            // Не спамим общий чат — сообщение о подтверждении самоудаляется
            // через несколько секунд. Inline-сообщения (editTarget без
            // chat_id/message_id) удалить нельзя — только редактировать,
            // поэтому для них таймер не ставим. Рестарт процесса в пределах
            // TTL оставит сообщение висеть — таймер живёт только в памяти,
            // это осознанный компромисс, а не забытый edge case.
            if (editTarget && !editTarget.inline_message_id) {
              // unref: этот таймер не должен держать процесс живым при
              // graceful shutdown (и не подвешивает тестовый воркер Jest).
              setTimeout(() => {
                bot
                  .deleteMessage(editTarget.chat_id, editTarget.message_id)
                  .catch((error) =>
                    log.warn("Не удалось удалить сообщение подтверждения регистрации", {
                      message: error.message,
                    })
                  );
              }, REGISTRATION_CONFIRMED_TTL_MS).unref();
            }
          },
          (error) => handleEditMessageError(error, "Не удалось обновить сообщение подтверждения регистрации")
        );
      } else {
        log.warn("Нет цели для редактирования сообщения подтверждения регистрации", { chatId, userId });
      }
    } else if (parsed.type === "cancel_match") {
      const cancelResult = await cancelMatch.execute(player2, callbackQuery.from.identityToken);
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
        const editOptions = buildEditOptions();
        if (editOptions) {
          bot
            .editMessageText(ui.callback.matchCancelled, editOptions)
            .catch((error) =>
              handleEditMessageError(error, "Не удалось обновить сообщение об отмене матча")
            );
        } else {
          log.warn("Нет цели для редактирования сообщения об отмене матча", {
            chatId,
            player: player2,
          });
          bot
            .sendMessage(chatId, ui.callback.matchCancelled)
            .catch((error) =>
              handleEditMessageError(error, "Не удалось отправить уведомление об отмене матча")
            );
        }
      }
    } else if (parsed.type === "direct_accept") {
      const invite = await consumeDirectInvite(context, callbackId, parsed.inviteId, player2, userId, "opponent");
      if (!invite) return;
      const { player: player1 } = invite;

      if (await isInviteParticipantBanned(invite, "initiator")
        || await isInviteParticipantBanned(invite, "opponent")) {
        await bot.answerCallbackQuery(callbackId, { text: playerBannedMessage, show_alert: true }).catch(console.error);
        return;
      }

      const addResult = await addMatch.execute(player1, player2, {
        scheduleLifecycle: !isPauseModeEnabled(chatId),
        participantIdentities: {
          [player1]: invite.playerIdentity,
          [player2]: callbackQuery.from.identityToken,
        },
        inviteIdentities: {
          [player1]: invite.playerIdentity,
          [player2]: invite.opponentIdentity,
        },
      });
      if (addResult.ok) {
        const editOptions = buildEditOptions();
        if (editOptions) {
          bot
            .editMessageText(messages.directAcceptedShort(), editOptions)
            .catch((error) =>
              handleEditMessageError(error, "Не удалось обновить сообщение о принятии прямого матча")
            );
        } else {
          log.warn("Нет цели для обновления сообщения о принятии прямого матча", { chatId, player1, player2 });
          bot
            .sendMessage(chatId, messages.directAcceptedShort())
            .catch((error) =>
              handleEditMessageError(error, "Не удалось отправить сообщение о принятии прямого матча")
            );
        }
        await notifyQueuePausedIfNeeded(chatId, queueReplyMessageId);
      } else {
        bot
          .answerCallbackQuery(callbackId, {
            text: addResult.text,
            show_alert: true,
          })
          .catch(console.error);
      }
    } else if (parsed.type === "direct_decline") {
      const invite = await consumeDirectInvite(context, callbackId, parsed.inviteId, player2, userId, "opponent");
      if (!invite) return;
      const { player: player1 } = invite;

      if (await isInviteParticipantBanned(invite, "initiator")) {
        await bot.answerCallbackQuery(callbackId, { text: playerBannedMessage, show_alert: true }).catch(console.error);
        return;
      }

      await cancelSearch.execute(player1, invite.playerIdentity);
      context.notifier.notify(context.chatId, "", { type: "state_update" });
      const editOptions = buildEditOptions();
      if (editOptions) {
        bot
          .editMessageText(messages.directDeclined({ from: player1, to: player2 }), editOptions)
          .catch((error) =>
            handleEditMessageError(error, "Не удалось обновить сообщение об отказе в прямом матче")
          );
      } else {
        log.warn("Нет цели для обновления сообщения об отказе в прямом матче", { chatId, player1, player2 });
        bot
          .sendMessage(chatId, messages.directDeclined({ from: player1, to: player2 }))
          .catch((error) =>
            handleEditMessageError(error, "Не удалось отправить сообщение об отказе в прямом матче")
          );
      }
    } else if (parsed.type === "direct_cancel") {
      const inviteId = parsed.inviteId;
      const canDelete =
        callbackQuery.message?.chat?.id !== undefined &&
        callbackQuery.message?.message_id !== undefined;

      const invite = await consumeDirectInvite(context, callbackId, inviteId, player2, userId, "initiator");
      if (!invite) return;
      const { player: player1, opponent: invited } = invite;

      await cancelSearch.execute(player1, invite.playerIdentity);
      context.notifier.notify(context.chatId, "", { type: "state_update" });
      if (canDelete) {
        bot
          .deleteMessage(callbackQuery.message.chat?.id ?? chatId, callbackQuery.message.message_id)
          .catch((error) =>
            log.error("Не удалось удалить сообщение с прямым приглашением", { message: error.message })
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
        const editOptions = buildEditOptions();
        if (editOptions) {
          bot
            .editMessageText(messages.directCancelled({ from: player1, to: invited }), editOptions)
            .catch((error) =>
              handleEditMessageError(error, "Не удалось обновить сообщение об отмене прямого приглашения")
            );
        } else {
          log.warn("Нет цели для обновления сообщения об отмене прямого приглашения", {
            chatId,
            player: player1,
            invited,
          });
          bot
            .sendMessage(chatId, messages.directCancelled({ from: player1, to: invited }))
            .catch((error) =>
              handleEditMessageError(error, "Не удалось отправить сообщение об отмене прямого приглашения")
            );
        }
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
  };

  // Ошибки обработки callback не должны приводить к unhandled rejection:
  // отвечаем дружелюбным alert и логируем (включая QueueStateConflictError из CAS).
  bot.on("callback_query", async (callbackQuery) => {
    try {
      await handleCallbackQuery(callbackQuery);
    } catch (error) {
      log.error("Ошибка обработки callback", {
        data: callbackQuery.data,
        message: error.message,
      });
      bot
        .answerCallbackQuery(callbackQuery.id, {
          text: ui.callback.actionFailed,
          show_alert: true,
        })
        .catch(console.error);
    }
  });

  bot.on("polling_error", (error) => {
    log.error("Ошибка polling", { message: error.message });
  });

  if (queueChatId) {
    getContext(queueChatId);
  }

  if (autoStartPolling) void startLongPolling();

  return {
    bot,
    getContext,
    queueChatId,
    isPauseModeEnabled,
    setPauseMode,
    emergeStateByChat,
    applyPauseMode,
    resumeEmergeAfterContinue,
    resumeQueueAfterPause,
    handleEmerge,
    shouldHoldMatch,
    messages,
    ui,
    buildMatchCancelKeyboard,
    startPolling: startLongPolling,
    dispose,
    onDispose,
    log,
  };
};

export { createBot };
