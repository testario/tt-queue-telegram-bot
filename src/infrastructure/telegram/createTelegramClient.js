import { Bot } from 'node-telegram-bot-api'
import { AsyncLocalStorage } from 'node:async_hooks'

const normalizeReplyOptions = (options = {}) => {
  if (!options.reply_to_message_id || options.reply_parameters) return options

  const { reply_to_message_id: replyToMessageId, ...rest } = options
  return {
    ...rest,
    reply_parameters: { message_id: replyToMessageId },
  }
}

class TelegramApiAdapter {
  constructor(token, options = {}) {
    this.token = token
    this.pollingOptions = options.polling?.params ?? {}
    this.pollingErrorHandlers = []
    this.pollingPromise = null
    this.handlerContext = new AsyncLocalStorage()
    this.bot = new Bot(token)
    this.api = this.bot.api

    this.bot.catch((error) => {
      this.emitPollingError(error)
    })
  }

  onText(pattern, handler) {
    const listener = async (context, next) => {
      const message = context.update.message
      const match = pattern.exec(message?.text ?? '')

      if (match) await this.runHandler(handler, message, match)
      await next()
    }
    listener.legacyPattern = pattern
    listener.legacyHandler = handler
    this.bot.on('message', listener)
  }

  on(event, handler) {
    if (event === 'polling_error') {
      this.pollingErrorHandlers.push(handler)
      return
    }

    const listener = async (context, next) => {
      await this.runHandler(handler, context.update[event])
      await next()
    }
    listener.legacyHandler = handler
    this.bot.on(event, listener)
  }

  startPolling() {
    if (this.pollingPromise) return

    this.pollingPromise = this.bot
      .startPolling(undefined, {
        timeout: this.pollingOptions.timeout,
        allowedUpdates: this.pollingOptions.allowed_updates,
        onError: (error) => this.emitPollingError(error),
      })
      .catch((error) => this.emitPollingError(error))
      .finally(() => {
        this.pollingPromise = null
      })
  }

  async stopPolling() {
    this.bot.stop()
    if (!this.handlerContext.getStore()) await this.pollingPromise
  }

  deleteWebHook() {
    return this.api.deleteWebhook()
  }

  setMyCommands(commands, options = {}) {
    return this.api.setMyCommands({ commands, ...options })
  }

  getChatMember(chatId, userId) {
    return this.api.getChatMember({ chat_id: chatId, user_id: userId })
  }

  getChatAdministrators(chatId) {
    return this.api.getChatAdministrators({ chat_id: chatId })
  }

  getUserProfilePhotos(userId, options = {}) {
    return this.api.getUserProfilePhotos({ user_id: userId, ...options })
  }

  async getFileLink(fileId) {
    const file = await this.api.getFile({ file_id: fileId })
    return `https://api.telegram.org/file/bot${this.token}/${file.file_path}`
  }

  sendMessage(chatId, text, options = {}) {
    return this.api.sendMessage({
      chat_id: chatId,
      text,
      ...normalizeReplyOptions(options),
    })
  }

  answerCallbackQuery(callbackQueryId, options = {}) {
    return this.api.answerCallbackQuery({ callback_query_id: callbackQueryId, ...options })
  }

  answerInlineQuery(inlineQueryId, results, options = {}) {
    return this.api.answerInlineQuery({ inline_query_id: inlineQueryId, results, ...options })
  }

  editMessageText(text, options = {}) {
    return this.api.editMessageText({ text, ...normalizeReplyOptions(options) })
  }

  editMessageReplyMarkup(replyMarkup, options = {}) {
    return this.api.editMessageReplyMarkup({ ...options, reply_markup: replyMarkup })
  }

  deleteMessage(chatId, messageId) {
    return this.api.deleteMessage({ chat_id: chatId, message_id: messageId })
  }

  emitPollingError(error) {
    for (const handler of this.pollingErrorHandlers) handler(error)
  }

  runHandler(handler, ...args) {
    return this.handlerContext.run(true, () => handler(...args))
  }
}

/**
 * Создает клиент Telegram API v2 с единой границей для кода приложения.
 */
export function createTelegramClient(token, options) {
  return new TelegramApiAdapter(token, options)
}
