import { jest } from '@jest/globals'
import { createTelegramClient } from '#infrastructure/telegram/createTelegramClient.js'

describe('Telegram API v2 client', () => {
  it('converts legacy reply parameters to the v2 request shape', async () => {
    const client = createTelegramClient('token')
    const sendMessage = jest.fn().mockResolvedValue(undefined)
    client.api.sendMessage = sendMessage

    await client.sendMessage(123, 'Готово', { reply_to_message_id: 456 })

    expect(sendMessage).toHaveBeenCalledWith({
      chat_id: 123,
      text: 'Готово',
      reply_parameters: { message_id: 456 },
    })
  })

  it('uses the configured HTTP proxy for Telegram requests', async () => {
    const fetch = jest.fn().mockResolvedValue({ ok: true })
    const client = createTelegramClient('token', {
      proxyUrl: 'http://127.0.0.1:8080',
      fetch,
    })

    await client.api.transport.fetchImpl('https://api.telegram.org', { method: 'POST' })

    expect(fetch).toHaveBeenCalledWith('https://api.telegram.org', {
      method: 'POST',
      dispatcher: client.proxyAgent,
    })
  })

  it('supports every Telegram method used by the WebApp', async () => {
    const client = createTelegramClient('token')
    const getChatAdministrators = jest.fn().mockResolvedValue([])
    const getUserProfilePhotos = jest.fn().mockResolvedValue({ total_count: 1 })
    const getFile = jest.fn().mockResolvedValue({ file_path: 'photos/avatar.jpg' })
    const editMessageReplyMarkup = jest.fn().mockResolvedValue(undefined)
    client.api.getChatAdministrators = getChatAdministrators
    client.api.getUserProfilePhotos = getUserProfilePhotos
    client.api.getFile = getFile
    client.api.editMessageReplyMarkup = editMessageReplyMarkup

    await client.getChatAdministrators(-100)
    await client.getUserProfilePhotos(123, { limit: 1 })
    const fileLink = await client.getFileLink('file-id')
    await client.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: -100, message_id: 5 })

    expect(getChatAdministrators).toHaveBeenCalledWith({ chat_id: -100 })
    expect(getUserProfilePhotos).toHaveBeenCalledWith({ user_id: 123, limit: 1 })
    expect(getFile).toHaveBeenCalledWith({ file_id: 'file-id' })
    expect(fileLink).toBe('https://api.telegram.org/file/bottoken/photos/avatar.jpg')
    expect(editMessageReplyMarkup).toHaveBeenCalledWith({
      reply_markup: { inline_keyboard: [] },
      chat_id: -100,
      message_id: 5,
    })
  })

  it('passes v2 updates to command and callback handlers', async () => {
    const client = createTelegramClient('token')
    const startHandler = jest.fn()
    const commandHandler = jest.fn()
    const callbackHandler = jest.fn()

    client.onText(/^\/start$/, startHandler)
    client.onText(/^\/play\s+(.+)$/, commandHandler)
    client.on('callback_query', callbackHandler)

    await client.bot.handleUpdate({
      update_id: 1,
      message: { text: '/play @bob', chat: { id: 123 }, from: { id: 456 } },
    })
    await client.bot.handleUpdate({
      update_id: 2,
      callback_query: { id: 'callback-id', from: { id: 456 } },
    })

    expect(commandHandler).toHaveBeenCalledWith(
      expect.objectContaining({ text: '/play @bob' }),
      expect.arrayContaining(['/play @bob', '@bob'])
    )
    expect(startHandler).not.toHaveBeenCalled()
    expect(callbackHandler).toHaveBeenCalledWith(expect.objectContaining({ id: 'callback-id' }))
  })

  it('starts polling without blocking lifecycle initialization and waits for it on stop', async () => {
    const client = createTelegramClient('token', {
      polling: { params: { timeout: 50, allowed_updates: ['message'] } },
    })
    let resolvePolling
    const pollingPromise = new Promise((resolve) => {
      resolvePolling = resolve
    })
    client.bot.startPolling = jest.fn(() => pollingPromise)
    client.bot.stop = jest.fn(() => resolvePolling())

    await client.startPolling()

    expect(client.bot.startPolling).toHaveBeenCalledWith(undefined, {
      timeout: 50,
      allowedUpdates: ['message'],
      onError: expect.any(Function),
    })

    await client.stopPolling()
    expect(client.bot.stop).toHaveBeenCalledTimes(1)
  })

  it('does not deadlock when a command stops its own polling handler', async () => {
    const client = createTelegramClient('token')
    client.bot.stop = jest.fn()
    client.pollingPromise = new Promise(() => {})
    client.onText(/^\/stop$/, () => client.stopPolling())

    await client.bot.handleUpdate({
      update_id: 1,
      message: { text: '/stop', chat: { id: 123 }, from: { id: 456 } },
    })

    expect(client.bot.stop).toHaveBeenCalledTimes(1)
  })
})
