import { jest } from '@jest/globals'
import { createWebApp, buildBackendContext } from '#interfaces/webapp/index.js'

describe('all-in-one webapp composition', () => {
  const previousNodeEnv = process.env.NODE_ENV
  const previousPort = process.env.WEBAPP_PORT

  beforeEach(() => {
    process.env.NODE_ENV = 'test'
    process.env.WEBAPP_PORT = '0'
  })

  afterEach(() => {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
    if (previousPort === undefined) delete process.env.WEBAPP_PORT
    else process.env.WEBAPP_PORT = previousPort
  })

  test('composes resumeQueueAfterPause into /api/admin/continue', async () => {
    const context = {
      chatId: 'queue',
      testIdentityActivation: jest.fn().mockResolvedValue({
        username: '@dev_user',
        userId: 123456,
        generation: 1,
        status: 'active',
      }),
      repository: {
        get: jest.fn().mockResolvedValue({ queue: [], searching: [], played: [] }),
      },
      clock: { now: () => new Date('2026-01-01T12:00:00.000Z') },
      notifier: { onMessage: jest.fn() },
    }
    const resumeQueueAfterPause = jest.fn().mockResolvedValue({ hasQueue: false })
    const bot = {
      getChatMember: jest.fn().mockResolvedValue({ status: 'administrator' }),
      sendMessage: jest.fn().mockResolvedValue(undefined),
    }
    const playersRepository = {
      upsert: jest.fn().mockResolvedValue(undefined),
      isVerified: jest.fn().mockResolvedValue(true),
    }
    const invitesStore = { getAll: jest.fn().mockResolvedValue([]) }
    const appResult = await createWebApp({
      bot,
      getContext: () => context,
      queueChatId: 'queue',
      isPauseModeEnabled: () => true,
      setPauseMode: jest.fn(),
      emergeStateByChat: new Map(),
      applyPauseMode: jest.fn(),
      resumeEmergeAfterContinue: jest.fn().mockResolvedValue({ handled: false }),
      resumeQueueAfterPause,
      handleEmerge: jest.fn(),
      messages: {
        pauseModeDisabledNoQueue: jest.fn(() => 'resumed'),
      },
      ui: {},
      playersRepository,
      invitesStore,
      log: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
    })

    try {
      const response = await appResult.app.inject({
        method: 'POST',
        url: '/api/admin/continue',
      })

      expect(response.statusCode).toBe(200)
      expect(resumeQueueAfterPause).toHaveBeenCalledWith(context)
    } finally {
      await appResult.app.close()
    }
  })

  // Кросс-процессный релей подтверждения регистрации (bot-процесс →
  // notifier/Redis → sseManager.notifyUser) — см. src/interfaces/webapp/index.js.
  // В all-in-one режиме источник событий — локальный notifier.onMessage, и
  // player_verified обрабатывается веткой, которая return'ится ДО блокового
  // broadcast('state_update', ...) — в отличие от backend-only режима (см.
  // тест ниже), где второй handler лишь дополняет уже существующий
  // безусловный broadcast, а не заменяет его.
  test('relays a local player_verified notification to sseManager.notifyUser without a state_update broadcast', async () => {
    let capturedHandler
    const context = {
      chatId: 'queue',
      testIdentityActivation: jest.fn(),
      repository: {
        get: jest.fn().mockResolvedValue({ queue: [], searching: [], played: [] }),
      },
      clock: { now: () => new Date('2026-01-01T12:00:00.000Z') },
      notifier: { onMessage: (handler) => { capturedHandler = handler } },
    }
    const appResult = await createWebApp({
      bot: {},
      getContext: () => context,
      queueChatId: 'queue',
      isPauseModeEnabled: () => false,
      emergeStateByChat: new Map(),
      messages: {},
      ui: {},
      playersRepository: {},
      invitesStore: { getAll: jest.fn().mockResolvedValue([]) },
      log: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
    })

    try {
      const notifyUser = jest.spyOn(appResult.sseManager, 'notifyUser')
      const broadcast = jest.spyOn(appResult.sseManager, 'broadcast')

      await capturedHandler({ chatId: 'queue', text: '', meta: { type: 'player_verified', userId: '77' } })

      expect(notifyUser).toHaveBeenCalledWith('77', 'player_verified', { verified: true })
      expect(broadcast).not.toHaveBeenCalled()

      // Untouched: a real state_update-shaped notification still broadcasts,
      // proving the new branch didn't swallow the existing behavior.
      await capturedHandler({ chatId: 'queue', text: '', meta: { type: 'state_update' } })
      expect(broadcast).toHaveBeenCalledWith('state_update', expect.any(Object))
    } finally {
      await appResult.app.close()
    }
  })

  // Backend-only (Redis) вариант того же релея. RedisEventBus поддерживает
  // несколько независимых handler'ов на одном канале (см. sse.js/index.js) —
  // здесь это эмулируется массивом handlers, куда попадают оба подписчика:
  // существующий блоковый (sseManager.subscribeToRedis) и новый, точечный.
  // В отличие от all-in-one теста выше, блоковый handler здесь НЕ фильтрует
  // по типу события и сработает на player_verified тоже — это осознанный,
  // безобидный побочный эффект, а не то, что нужно предотвращать.
  test('relays player_verified over the Redis eventBus to sseManager.notifyUser (backend-only)', async () => {
    const handlers = []
    const eventBus = {
      subscribe: async (handler) => { handlers.push(handler) },
    }
    const queueRepository = {
      get: jest.fn().mockResolvedValue({ queue: [], searching: [], played: [] }),
      getVersioned: jest.fn().mockResolvedValue({
        state: { queue: [], searching: [], played: [] },
        revision: 0,
      }),
    }
    const appResult = await createWebApp({
      bot: { sendMessage: jest.fn().mockResolvedValue(undefined) },
      queueRepository,
      eventBus,
      playersRepository: {},
      invitesStore: { getAll: jest.fn().mockResolvedValue([]) },
      queueChatId: 'queue',
      log: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
    })

    try {
      const notifyUser = jest.spyOn(appResult.sseManager, 'notifyUser')

      expect(handlers.length).toBeGreaterThanOrEqual(2)
      for (const handler of handlers) {
        await handler({ type: 'player_verified', chatId: 'queue', payload: { type: 'player_verified', userId: '77' } })
      }

      expect(notifyUser).toHaveBeenCalledWith('77', 'player_verified', { verified: true })
    } finally {
      await appResult.app.close()
    }
  })

  // invitesStore не связан с AddMatch напрямую — это внутренняя проводка,
  // и если её потерять при рефакторинге, приглашения снова начнут сиротеть
  // (см. AddMatch.discardStaleInvites), а ни один тест этого не
  // заметит, пока backend-only режим не соберёт контекст сам.
  test('backend-only context wires invitesStore into AddMatch', () => {
    const invitesStore = { getAll: jest.fn(), deleteByParticipant: jest.fn() }
    const queueRepository = { getVersioned: jest.fn(), saveIfRevision: jest.fn() }
    const bot = { sendMessage: jest.fn().mockResolvedValue(undefined) }

    const context = buildBackendContext({
      queueRepository,
      queueChatId: 'queue',
      messages: {},
      ui: {},
      bot,
      log: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
      playersRepository: {},
      invitesStore,
    })

    expect(context.addMatch.invitesStore).toBe(invitesStore)
  })
})
