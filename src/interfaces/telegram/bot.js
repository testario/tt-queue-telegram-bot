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
import { templates } from "#application/messages/templates.js";
import { RegisterSearch } from "#application/usecases/RegisterSearch.js";
import { AddMatch } from "#application/usecases/AddMatch.js";
import { CancelSearch } from "#application/usecases/CancelSearch.js";
import { CancelMatch } from "#application/usecases/CancelMatch.js";
import { GetQueue } from "#application/usecases/GetQueue.js";
import { GetPlayed } from "#application/usecases/GetPlayed.js";
import { parseCallbackData } from "#application/parsers/callbackData.js";

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
 * @property {CancelSearch} cancelSearch
 * @property {CancelMatch} cancelMatch
 * @property {GetQueue} getQueue
 * @property {GetPlayed} getPlayed
 * @property {string|null} inlineMessageId
 */

/**
 * Создает и настраивает Telegram-бота с контекстами чатов.
 * @param {string} token
 * @param {{ logger?: Logger }} [options]
 * @returns {TelegramApi}
 */
const createBot = (token, { logger } = {}) => {
  const log = logger || createLogger({ prefix: "bot" });
  log.info("Инициализация бота");
  const contexts = new Map();
  const userChatBindings = new Map();

  const resolveChatIdFromMessage = (message) => message?.chat?.id || null;
  const resolveChatIdFromCallback = (callbackQuery) =>
    callbackQuery?.message?.chat?.id || userChatBindings.get(callbackQuery?.from?.id) || null;
  const resolveChatIdFromUser = (userId) => (userId ? userChatBindings.get(userId) || null : null);
  const bindUserToChat = (userId, chatId) => {
    if (userId && chatId) {
      userChatBindings.set(userId, chatId);
    }
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
  let isStopped = false;
  const MAX_TEST_MATCHES = 10;
  const isTestFeatureEnabled = process.env.ENABLE_TEST_FEATURE === "true";

  const isMessageNotModifiedError = (error) =>
    error?.response?.body?.description?.includes("message is not modified");

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
      messages: templates,
      clock,
      logger: log.child(`service:orchestrator:${chatId}`),
    });

    const registerSearch = new RegisterSearch({
      repository,
      queueService,
      messages: templates,
      clock,
      logger: log.child(`usecase:RegisterSearch:${chatId}`),
    });
    const addMatch = new AddMatch({
      chatId,
      repository,
      queueService,
      orchestrator,
      notifier,
      messages: templates,
      clock,
      logger: log.child(`usecase:AddMatch:${chatId}`),
    });
    const cancelSearch = new CancelSearch({
      repository,
      queueService,
      messages: templates,
      clock,
      logger: log.child(`usecase:CancelSearch:${chatId}`),
    });
    const cancelMatch = new CancelMatch({
      chatId,
      repository,
      queueService,
      orchestrator,
      notifier,
      messages: templates,
      clock,
      logger: log.child(`usecase:CancelMatch:${chatId}`),
    });
    const getQueue = new GetQueue({
      repository,
      messages: templates,
      logger: log.child(`usecase:GetQueue:${chatId}`),
    });
    const getPlayed = new GetPlayed({
      repository,
      queueService,
      messages: templates,
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
      cancelSearch,
      cancelMatch,
      getQueue,
      getPlayed,
      inlineMessageId: null,
    };

    notifier.onMessage(({ chatId: targetChatId, text }) => {
      if (targetChatId !== chatId) return;

      bot
        .sendMessage(chatId, text)
        .catch((error) =>
          log.error("Не удалось отправить уведомление", {
            chatId,
            message: error.message,
          })
        );
    });

    contexts.set(chatId, context);
    return context;
  };

  const buildSearchInlineKeyboard = (player) => ({
    inline_keyboard: [
      [
        {
          text: "Хочу сыграть с ним!",
          callback_data: "i_want_to_play_with_:" + player,
        },
        {
          text: "Я автор, хочу отменить",
          callback_data: "i_want_to_cancel:" + player,
        },
      ],
    ],
  });

  const createTestMatches = async (chatId, count) => {
    const context = getContext(chatId);
    if (!context) {
      return { created: [], failed: [{ reason: "no_context", text: "Контекст чата не найден" }] };
    }

    const { registerSearch, addMatch } = context;
    const testCount = Math.min(count, MAX_TEST_MATCHES);
    const timestamp = Date.now();
    const created = [];
    const failed = [];

    for (let i = 0; i < testCount; i += 1) {
      const searcher = `Тестовый_${timestamp}_${i}_A`;
      const opponent = `Тестовый_${timestamp}_${i}_B`;

      await registerSearch.execute(searcher);
      const addResult = await addMatch.execute(searcher, opponent);

      if (addResult.ok) {
        created.push({ searcher, opponent });
      } else {
        failed.push({ searcher, opponent, reason: addResult.reason, text: addResult.text });
      }
    }

    return { created, failed };
  };

  const formatTestSummary = (created) =>
    created.length > 0
      ? `Создано тестовых матчей: ${created.length}\n${created
          .map(({ searcher, opponent }, index) => `${index + 1}. ${searcher} vs ${opponent}`)
          .join("\n")}`
      : "Не удалось создать тестовые матчи";

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
      await bot.sendMessage(chatId, templates.botStopped());
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
    bot.sendMessage(chatId, templates.greet());
  });

  bot.onText(/\/stop/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from?.username;
    await stopBot(chatId, username);
  });

  bot.on("inline_query", async (query) => {
    const player = "@" + query.from.username;
    const chatId = resolveChatIdFromUser(query.from?.id);
    log.info("Получен inline запрос", { player, chatId });

    if (!chatId) {
      bot.answerInlineQuery(
        query.id,
        [
          {
            type: "article",
            id: "no_chat_binding",
            title: "Сначала нажми /start в чате",
            input_message_content: {
              message_text: "Нужно открыть чат с ботом и отправить /start, чтобы привязать очередь к чату.",
            },
            description: "Нет привязки к чату, команды недоступны",
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
            title: "Контекст чата не готов",
            input_message_content: {
              message_text: "Не удалось найти контекст чата, попробуйте снова или отправьте /start.",
            },
            description: "Попробуйте заново",
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
        title: "Найти игрока",
        input_message_content: {
          message_text: templates.searchAdded(player),
        },
        description: "Крикнуть на весь чат, как ты хочешь поиграть с кем-нибудь",
        reply_markup: {
          inline_keyboard: buildSearchInlineKeyboard(player).inline_keyboard,
        },
      },
      {
        type: "article",
        id: "2",
        title: "Проверить очередь",
        input_message_content: {
          message_text: queueText,
        },
        description: "Можно посмотреть, кто ожидает игру и время последней игры",
      },
      {
        type: "article",
        id: "3",
        title: "Посмотреть тех, кто уже отыграл",
        input_message_content: {
          message_text: playedText,
        },
        description: "Проверить список отыгравших в текущей половине дня",
      },
    ];

    if (isTestFeatureEnabled) {
      results.push(
        {
          type: "article",
          id: "test:1",
          title: "Создать 1 тестовый матч",
          input_message_content: {
            message_text: "Создаю 1 тестовый матч",
          },
          description: "Генерация одного тестового матча",
          reply_markup: {
            inline_keyboard: [[{ text: "Создать", callback_data: "inline_test:1" }]],
          },
        },
        {
          type: "article",
          id: "test:3",
          title: "Создать 3 тестовых матча",
          input_message_content: {
            message_text: "Создаю 3 тестовых матча",
          },
          description: "Быстро создать три тестовых матча",
          reply_markup: {
            inline_keyboard: [[{ text: "Создать", callback_data: "inline_test:3" }]],
          },
        },
        {
          type: "article",
          id: "test:5",
          title: "Создать 5 тестовых матчей",
          input_message_content: {
            message_text: "Создаю 5 тестовых матчей",
          },
          description: "Создает пять тестовых матчей с фейковыми игроками",
          reply_markup: {
            inline_keyboard: [[{ text: "Создать", callback_data: "inline_test:5" }]],
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
          text: "Нужно начать диалог с ботом в чате (/start), чтобы обрабатывать запросы.",
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
          text: "Контекст чата не готов, попробуйте отправить /start.",
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

    if (parsed.type === "play_with") {
      const player1 = parsed.player;
      const addResult = await addMatch.execute(player1, player2);
      if (addResult.ok) {
        log.info("Матч принят через callback", { player1, player2 });
        bot
          .editMessageText(addResult.text, {
            inline_message_id: messageId,
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "Нет времени на игры!",
                    callback_data: `i_want_to_out:${player1},${player2}`,
                  },
                ],
              ],
            },
          })
          .catch((error) =>
            handleEditMessageError(error, "Не удалось обновить inline сообщение подтверждения матча")
          );
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
            text: "Только автор может отменить заявку",
            show_alert: true,
          })
          .catch(console.error);
        return;
      }
      const cancelResult = await cancelSearch.execute(parsed.player);
      if (cancelResult.status === "removed") {
        bot
          .editMessageText(templates.searchCancelled(), {
            inline_message_id: messageId,
          })
          .catch((error) =>
            handleEditMessageError(error, "Не удалось обновить inline сообщение об отмене поиска")
          );
      } else {
        bot
          .answerCallbackQuery(callbackId, {
            text: "Заявка уже была удалена",
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
            text: "Нельзя отменять чужие игры",
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
            text: "Матч не найден",
            show_alert: true,
          })
          .catch(console.error);
      } else {
        log.info("Матч отменен по callback", { player: player2, status: cancelResult.status });
        bot
          .editMessageText("Матч отменен", {
            inline_message_id: messageId,
          })
          .catch((error) =>
            handleEditMessageError(error, "Не удалось обновить inline сообщение об отмене матча")
          );
      }
    } else if (parsed.type === "inline_test") {
      if (!isTestFeatureEnabled) {
        bot
          .answerCallbackQuery(callbackId, {
            text: "Тестовый режим отключен",
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

