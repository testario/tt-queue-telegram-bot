const toLegacyOptions = ({ reply_parameters: replyParameters, ...options } = {}) =>
  replyParameters?.message_id
    ? { ...options, reply_to_message_id: replyParameters.message_id }
    : options

const callWithOptions = (method, args, options) => {
  if (Object.keys(options).length === 0) {
    return method(...args)
  }

  return method(...args, options)
}

export const createTelegramApiV2 = (fakeBot) => ({
  sendMessage: ({ chat_id: chatId, text, ...options }) =>
    callWithOptions(fakeBot.sendMessage, [chatId, text], toLegacyOptions(options)),
  editMessageText: ({ text, ...options }) =>
    callWithOptions(fakeBot.editMessageText, [text], toLegacyOptions(options)),
  deleteMessage: ({ chat_id: chatId, message_id: messageId }) => fakeBot.deleteMessage(chatId, messageId),
  setMyCommands: ({ commands, ...options }) => fakeBot.setMyCommands(commands, options),
  answerCallbackQuery: ({ callback_query_id: callbackQueryId, ...options }) =>
    fakeBot.answerCallbackQuery(callbackQueryId, options),
  answerInlineQuery: ({ inline_query_id: inlineQueryId, results, ...options }) =>
    fakeBot.answerInlineQuery(inlineQueryId, results, options),
  getChatMember: ({ chat_id: chatId, user_id: userId }) => fakeBot.getChatMember(chatId, userId),
  deleteWebhook: () => fakeBot.deleteWebHook(),
})
