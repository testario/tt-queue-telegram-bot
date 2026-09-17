import { jest } from '@jest/globals'
import { InMemoryQueueRepository } from '#infrastructure/repositories/InMemoryQueueRepository.js'
import { Match } from '#domain/entities/Match.js'
import { QueueState } from '#domain/entities/QueueState.js'

const instances = []

class FakeTelegramApi {
  constructor() {
    this.textHandlers = []
    this.eventHandlers = new Map()
    this.sendMessage = jest.fn().mockResolvedValue(undefined)
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

describe('bot ownership and shutdown', () => {
  const previousChatId = process.env.TG_CHAT_ID

  beforeEach(() => {
    process.env.TG_CHAT_ID = 'queue'
    instances.length = 0
  })

  afterAll(() => {
    if (previousChatId === undefined) delete process.env.TG_CHAT_ID
    else process.env.TG_CHAT_ID = previousChatId
  })

  test('bot-created announcement is sent locally once and /stop invokes owner shutdown', async () => {
    const eventBus = { publish: jest.fn().mockResolvedValue(undefined) }
    let botResult
    const closeOrder = []
    const reconcilerDispose = jest.fn(async () => closeOrder.push('reconciler'))
    const ownerShutdown = jest.fn(async () => botResult.dispose())
    botResult = createBot('token', {
      queueRepository: new InMemoryQueueRepository(),
      eventBus,
      autoStartPolling: false,
      onDispose: reconcilerDispose,
      onStop: ownerShutdown,
    })
    const fakeBot = instances[0]
    const context = botResult.getContext('queue')
    context.orchestrator.dispose = jest.fn(async () => closeOrder.push('orchestrator'))
    fakeBot.stopPolling.mockImplementation(async () => closeOrder.push('polling'))
    const match = {
      player1: '@alice',
      player2: '@bob',
      startDate: new Date('2026-01-01T12:00:00.000Z'),
      endDate: new Date('2026-01-01T13:00:00.000Z'),
      status: 'playing',
    }

    context.notifier.notify('queue', 'created', { type: 'match_created', match })
    await Promise.resolve()

    expect(fakeBot.sendMessage).toHaveBeenCalledTimes(1)
    expect(eventBus.publish).toHaveBeenCalledTimes(1)

    const stopHandler = fakeBot.textHandlers.find(({ pattern }) => pattern.test('/stop')).handler
    await stopHandler({ chat: { id: 'queue' }, from: { username: 'admin' } })
    await stopHandler({ chat: { id: 'queue' }, from: { username: 'admin' } })

    expect(ownerShutdown).toHaveBeenCalledTimes(1)
    expect(reconcilerDispose).toHaveBeenCalledTimes(1)
    expect(fakeBot.stopPolling).toHaveBeenCalledTimes(1)
    expect(closeOrder).toEqual(['polling', 'reconciler', 'orchestrator'])
  })

  test('bot /pause loses no accepted match when CAS conflicts with a concurrent direct-accept', async () => {
    const inner = new InMemoryQueueRepository()
    let injected = false
    let botResult
    const repository = {
      getVersioned: (...args) => inner.getVersioned(...args),
      save: (...args) => inner.save(...args),
      saveIfRevision: async (expectedRevision, state) => {
        if (injected) return inner.saveIfRevision(expectedRevision, state)
        injected = true
        // Конкурентный direct-accept: принимающий создаёт матч, пока /pause сохраняет свой снапшот
        const acceptResult = await botResult.getContext('queue').addMatch.execute('@p1', '@p2')
        if (!acceptResult.ok) throw new Error(`accept injection failed: ${acceptResult.reason}`)
        return false
      },
    }
    botResult = createBot('token', {
      queueRepository: repository,
      eventBus: { publish: jest.fn().mockResolvedValue(undefined) },
      autoStartPolling: false,
    })
    const fakeBot = instances[0]

    // Матч идёт меньше порога продолжения (5 минут), чтобы пауза заморозила всю очередь
    const baseTime = new Date(Date.now() - 60_000)
    const initial = await inner.get()
    initial.enqueue(
      Match.create({
        player1: '@old1',
        player2: '@old2',
        startDate: baseTime,
        endDate: new Date(baseTime.getTime() + 3_600_000),
        status: Match.statuses.playing,
      })
    )
    initial.addSearching('@p1')
    await inner.save(initial)

    const pauseHandler = fakeBot.textHandlers.find(({ pattern }) => pattern.test('/pause')).handler
    await pauseHandler({ chat: { id: 'queue' }, from: { id: 7, username: 'admin' }, message_id: 5 })

    const finalState = await inner.get()
    expect(finalState.queue).toHaveLength(2)
    const accepted = finalState.queue.find((match) => match.player1 === '@p1')
    expect(accepted).toBeDefined()
    expect(accepted.player2).toBe('@p2')
    expect(accepted.status).toBe(Match.statuses.waiting)
    expect(finalState.queue[0].status).toBe(Match.statuses.waiting)
    // Текущий матч заморожен (не продолжается), поэтому hold-флаг не нужен
    expect(finalState.holdNextMatch).toBe(false)
    expect(botResult.isPauseModeEnabled('queue')).toBe(true)
  })

  test('callback path answers a friendly alert on QueueStateConflictError without crashing', async () => {
    const conflictingRepository = {
      getVersioned: jest
        .fn()
        .mockResolvedValue({ state: QueueState.createEmpty(), revision: 0 }),
      saveIfRevision: jest.fn().mockResolvedValue(false),
      save: jest.fn(),
    }
    createBot('token', {
      queueRepository: conflictingRepository,
      autoStartPolling: false,
    })
    const fakeBot = instances[0]

    const callbackHandler = fakeBot.eventHandlers.get('callback_query')
    await callbackHandler({
      id: 'cb-conflict',
      from: { id: 9, username: 'player' },
      data: 'i_want_to_cancel:@player',
      message: { chat: { id: 'queue' } },
    })

    expect(conflictingRepository.saveIfRevision).toHaveBeenCalledTimes(3)
    expect(fakeBot.answerCallbackQuery).toHaveBeenCalledTimes(1)
    expect(fakeBot.answerCallbackQuery).toHaveBeenCalledWith('cb-conflict', {
      text: expect.stringContaining('попробуйте'),
      show_alert: true,
    })
  })
})
