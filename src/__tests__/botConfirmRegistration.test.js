import { jest } from '@jest/globals'
import { InMemoryQueueRepository } from '#infrastructure/repositories/InMemoryQueueRepository.js'
import { QueueState } from '#domain/entities/QueueState.js'

const instances = []

class FakeTelegramApi {
  constructor() {
    this.textHandlers = []
    this.eventHandlers = new Map()
    this.sendMessage = jest.fn().mockResolvedValue(undefined)
    this.editMessageText = jest.fn().mockResolvedValue(undefined)
    this.deleteMessage = jest.fn().mockResolvedValue(undefined)
    this.setMyCommands = jest.fn().mockResolvedValue(undefined)
    this.stopPolling = jest.fn().mockResolvedValue(undefined)
    this.answerCallbackQuery = jest.fn().mockResolvedValue(undefined)
    this.getChatMember = jest.fn().mockResolvedValue({ status: 'administrator' })
    instances.push(this)
  }

  onText(pattern, handler) {
    this.textHandlers.push({ pattern, handler })
  }

  on(event, handler) {
    this.eventHandlers.set(event, handler)
  }
}

jest.unstable_mockModule('node-telegram-bot-api', () => ({ default: FakeTelegramApi }))

const { createBot } = await import('#interfaces/telegram/bot.js')

const buildPlayersRepository = (overrides = {}) => ({
  upsert: jest.fn().mockResolvedValue(undefined),
  findOne: jest.fn().mockResolvedValue(null),
  findByUserId: jest.fn().mockResolvedValue(null),
  setVerified: jest.fn().mockResolvedValue(true),
  isBanned: jest.fn().mockResolvedValue(false),
  ...overrides,
})

describe('bot confirm_player callback', () => {
  const previousChatId = process.env.TG_CHAT_ID

  beforeEach(() => {
    process.env.TG_CHAT_ID = 'queue'
    instances.length = 0
  })

  afterAll(() => {
    if (previousChatId === undefined) delete process.env.TG_CHAT_ID
    else process.env.TG_CHAT_ID = previousChatId
  })

  test('confirms the matching player, edits the message, and publishes player_verified', async () => {
    const player = { username: '@alice', userId: 10, verified: false }
    const playersRepository = buildPlayersRepository({
      findByUserId: jest.fn().mockResolvedValue(player),
    })
    const eventBus = { publish: jest.fn().mockResolvedValue(undefined) }
    createBot('token', {
      queueRepository: new InMemoryQueueRepository(new QueueState({})),
      playersRepository,
      eventBus,
      autoStartPolling: false,
    })
    const fakeBot = instances[0]
    const callbackHandler = fakeBot.eventHandlers.get('callback_query')

    await callbackHandler({
      id: 'cb-confirm',
      from: { id: 10, username: 'alice' },
      data: 'confirm_player:10',
      message: { chat: { id: 'queue' }, message_id: 55 },
    })

    expect(playersRepository.setVerified).toHaveBeenCalledWith('@alice', true)
    expect(fakeBot.answerCallbackQuery).toHaveBeenCalledWith('cb-confirm', { text: expect.any(String) })
    expect(fakeBot.editMessageText).toHaveBeenCalledWith(
      expect.any(String),
      { chat_id: 'queue', message_id: 55, reply_markup: { inline_keyboard: [] } }
    )
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'player_verified',
        chatId: 'queue',
        payload: expect.objectContaining({ userId: '10' }),
      })
    )
    // Regression: notifier.notify(chatId, "", {type: "player_verified"}) must
    // never reach bot.sendMessage — Telegram rejects an empty message text.
    // The relay in bot.js filters this by an empty `text`, not by type.
    expect(fakeBot.sendMessage).not.toHaveBeenCalled()
  })

  test('rejects a tap from someone other than the requested player', async () => {
    const playersRepository = buildPlayersRepository()
    const eventBus = { publish: jest.fn().mockResolvedValue(undefined) }
    createBot('token', {
      queueRepository: new InMemoryQueueRepository(new QueueState({})),
      playersRepository,
      eventBus,
      autoStartPolling: false,
    })
    const fakeBot = instances[0]
    const callbackHandler = fakeBot.eventHandlers.get('callback_query')

    await callbackHandler({
      id: 'cb-wrong',
      from: { id: 20, username: 'bob' },
      data: 'confirm_player:10',
      message: { chat: { id: 'queue' }, message_id: 55 },
    })

    expect(playersRepository.setVerified).not.toHaveBeenCalled()
    expect(playersRepository.findByUserId).not.toHaveBeenCalled()
    expect(fakeBot.answerCallbackQuery).toHaveBeenCalledWith('cb-wrong', {
      text: expect.any(String),
      show_alert: true,
    })
    expect(fakeBot.editMessageText).not.toHaveBeenCalled()
    expect(eventBus.publish).not.toHaveBeenCalled()
  })

  test('a second tap after confirmation is idempotent: no second write, no second publish', async () => {
    const player = { username: '@alice', userId: 10, verified: true }
    const playersRepository = buildPlayersRepository({
      findByUserId: jest.fn().mockResolvedValue(player),
    })
    const eventBus = { publish: jest.fn().mockResolvedValue(undefined) }
    createBot('token', {
      queueRepository: new InMemoryQueueRepository(new QueueState({})),
      playersRepository,
      eventBus,
      autoStartPolling: false,
    })
    const fakeBot = instances[0]
    const callbackHandler = fakeBot.eventHandlers.get('callback_query')

    await callbackHandler({
      id: 'cb-again',
      from: { id: 10, username: 'alice' },
      data: 'confirm_player:10',
      message: { chat: { id: 'queue' }, message_id: 55 },
    })

    expect(playersRepository.setVerified).not.toHaveBeenCalled()
    expect(eventBus.publish).not.toHaveBeenCalled()
    expect(fakeBot.answerCallbackQuery).toHaveBeenCalledWith('cb-again', { text: expect.any(String) })
    expect(fakeBot.editMessageText).toHaveBeenCalled()
  })

  test('a banned presser is intercepted upstream, never reaching the confirm_player branch', async () => {
    const playersRepository = buildPlayersRepository({
      isBanned: jest.fn().mockResolvedValue(true),
      findByUserId: jest.fn().mockResolvedValue({ username: '@alice', userId: 10, verified: false }),
    })
    createBot('token', {
      queueRepository: new InMemoryQueueRepository(new QueueState({})),
      playersRepository,
      autoStartPolling: false,
    })
    const fakeBot = instances[0]
    const callbackHandler = fakeBot.eventHandlers.get('callback_query')

    await callbackHandler({
      id: 'cb-banned',
      from: { id: 10, username: 'alice' },
      data: 'confirm_player:10',
      message: { chat: { id: 'queue' }, message_id: 55 },
    })

    expect(playersRepository.setVerified).not.toHaveBeenCalled()
  })
})
