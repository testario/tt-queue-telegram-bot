require("dotenv").config();
const TelegramApi = require("node-telegram-bot-api");
const Queue = require("./entities/Queue.js");
const { emitter } = require("./entities/Message.js");

const queue = new Queue();

const token = process.env.TG_BOT_API_TOKEN;
const bot = new TelegramApi(token, { polling: true })

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, queue.greet());
  emitter.on("message", (e) => {
    bot.sendMessage(chatId, e)
  })
})

bot.on("inline_query", (query) => {
  const player = "@" + query.from.username;
  const results = [
    {
      type: 'article',
      id: '1',
      title: 'Найти игрока',
      input_message_content: {
        message_text: queue.wantToPlay(player),
      },
      description: "Крикнуть на весь чат, как ты хочешь поиграть с кем-нибудь",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "Хочу сыграть с ним!",
              callback_data: "i_want_to_play_with_:" + player
            },
            {
              text: "Я автор, хочу отменить",
              callback_data: "i_want_to_cansel:" + player
            }
          ]
        ]
      },
    },
    {
      type: 'article',
      id: '2',
      title: 'Проверить очередь',
      input_message_content: {
        message_text: queue.getList(),
      },
      description: 'Можно посмотреть, кто ожидает игру и время последней игры',
    },
    {
      type: 'article',
      id: '3',
      title: 'Посмотреть тех, кто уже отыграл',
      input_message_content: {
        message_text: queue.getPlayedList(),
      },
      description: 'Проверить список отыгравших в текущей половине дня',
    },
  ];
  bot.answerInlineQuery(query.id, results, { cache_time: 1 });
})

bot.on("polling_error", (error) => {
  console.log(error);
})

bot.on("callback_query", (callbackQuery) => {
  const callbackId = callbackQuery.id;
  const messageId = callbackQuery.inline_message_id;
  const data = callbackQuery.data;
  const player1 = data.split(":").pop();
  const player2 = "@" + callbackQuery.from.username;
  if (data.indexOf("i_want_to_play_with_") > -1) {
    if (queue.checkPlayerInSearch(player1)) {
      if (player1 !== player2) {
        const addGameResult = queue.add(player1, player2);
        if (addGameResult.status === 0) {
          bot.editMessageText(addGameResult.message, {
            inline_message_id: messageId,
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "Нет времени на игры!",
                    callback_data: `i_want_to_out:${player1},${player2}`
                  }
                ]
              ]
            },
          });
        } else {
          bot.answerCallbackQuery(callbackId, {
            text: 'Ты уже играл сегодня',
            show_alert: true
          }).catch(console.error);
        }
      } else {
        bot.answerCallbackQuery(callbackId, {
          text: "От стеночки можно поиграть и без очереди :)",
          show_alert: true
        }).catch(console.error);
      }
    } else {
      bot.answerCallbackQuery(callbackId, {
        text: "Этот игрок больше не ищет соперника",
        show_alert: true
      }).catch(console.error);
    }
  } else if (data.indexOf("i_want_to_cansel") > -1) {
    if (player1 === player2) {
      queue.removeFromSearch(player1);
      bot.editMessageText("Игрок передумал", {
        inline_message_id: messageId
      });
    } else {
      bot.answerCallbackQuery(callbackId, {
        text: "Только автор может отменить заявку",
        show_alert: true
      }).catch(console.error);
    }
  } else if (data.indexOf("i_want_to_out") > -1) {
    const playersInQueue = data.split(":").pop().split(",");
    if (playersInQueue.includes(player2)) {
      if (queue.checkPlayerInQueue(player2)) {
        queue.removeByPlayer(player2);
      }
    } else {
      bot.answerCallbackQuery(callbackId, {
        text: "Нельзя отменять чужие игры",
        show_alert: true
      }).catch(console.error);
    }
  }
});