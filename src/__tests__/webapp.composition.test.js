import { jest } from '@jest/globals'
import { createWebApp } from '#interfaces/webapp/index.js'

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
    const playersRepository = { upsert: jest.fn().mockResolvedValue(undefined) }
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
})
