import { createHmac } from 'node:crypto'
import Fastify from 'fastify'
import { jest } from '@jest/globals'
import { registerRoutes } from '#interfaces/webapp/router.js'
import { InMemoryInvitesStore } from '#infrastructure/invites/InMemoryInvitesStore.js'

const token = 'webapp-test-token'

const initDataFor = (user) => {
  const params = new URLSearchParams({ auth_date: '1', user: JSON.stringify(user) })
  const dataCheckString = Array.from(params.entries())
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secretKey = createHmac('sha256', 'WebAppData').update(token).digest()
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
  params.set('hash', hash)
  return params.toString()
}

const createHarness = async ({ production = false } = {}) => {
  process.env.NODE_ENV = production ? 'production' : 'test'

  const state = { queue: [], searching: [], played: [] }
  const invitesStore = new InMemoryInvitesStore()
  const playersRepository = { upsert: jest.fn().mockResolvedValue(undefined) }
  const context = {
    repository: { get: jest.fn().mockResolvedValue(state), save: jest.fn() },
    clock: { now: () => new Date('2026-01-01T00:00:00.000Z') },
    queueService: { readyMs: 0, gameMs: 0 },
    orchestrator: { cancelAll: jest.fn() },
    registerSearch: { execute: jest.fn().mockResolvedValue({ status: 'added' }) },
    cancelSearch: { execute: jest.fn().mockResolvedValue({ status: 'removed' }) },
    addMatch: { execute: jest.fn().mockResolvedValue({ ok: true }) },
    cancelMatch: { execute: jest.fn() },
    directMatch: {
      normalizeOpponent: jest.fn((opponent) => opponent.startsWith('@') ? opponent : `@${opponent}`),
      execute: jest.fn().mockResolvedValue({
        ok: true,
        invite: { player: '@alice', opponent: '@bob' },
      }),
    },
  }
  const bot = {
    sendMessage: jest.fn().mockResolvedValue(undefined),
    getChatMember: jest.fn(),
  }
  const sseManager = { addClient: jest.fn(), broadcast: jest.fn() }
  const log = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
  const messages = {
    directInvite: jest.fn().mockReturnValue('invite'),
    directAccepted: jest.fn().mockReturnValue('accepted'),
    directDeclined: jest.fn().mockReturnValue('declined'),
    directCancelled: jest.fn().mockReturnValue('cancelled'),
    searchAdded: jest.fn().mockReturnValue('search added'),
    searchCancelled: jest.fn().mockReturnValue('search cancelled'),
    matchAlreadyInQueue: jest.fn().mockReturnValue('invite exists'),
  }
  const app = Fastify()

  await registerRoutes(app, {
    bot,
    getContext: () => context,
    queueChatId: 'queue-chat',
    sseManager,
    isPauseModeEnabled: () => false,
    setPauseMode: jest.fn(),
    emergeStateByChat: new Map(),
    applyPauseMode: jest.fn(),
    resumeEmergeAfterContinue: jest.fn(),
    resumeQueueAfterPause: jest.fn(),
    handleEmerge: jest.fn(),
    messages,
    ui: { inline: { directAccept: 'accept', directDecline: 'decline', directCancel: 'cancel' } },
    log,
    playersRepository,
    invitesStore,
  })

  return { app, bot, context, invitesStore, log, messages, playersRepository, state, sseManager }
}

const authHeader = (username, id = 1) => ({
  'x-telegram-init-data': initDataFor({ id, username, first_name: username }),
})

describe('webapp REST routes', () => {
  const previousNodeEnv = process.env.NODE_ENV

  beforeAll(() => {
    process.env.TG_BOT_API_TOKEN = token
  })

  afterEach(() => {
    process.env.NODE_ENV = 'test'
  })

  afterAll(() => {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
  })

  test('upserts a Telegram user before granting route access', async () => {
    const harness = await createHarness()
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/direct',
      headers: authHeader('alice', 10),
      payload: { opponent: '@bob' },
    })

    expect(response.statusCode).toBe(200)
    expect(harness.playersRepository.upsert).toHaveBeenCalledWith({
      username: '@alice',
      userId: 10,
      firstName: 'alice',
      lastName: '',
    })
    await harness.app.close()
  })

  test('upserts the development fallback user', async () => {
    const harness = await createHarness()
    const response = await harness.app.inject({ method: 'POST', url: '/api/search' })

    expect(response.statusCode).toBe(200)
    expect(harness.playersRepository.upsert).toHaveBeenCalledWith({
      username: '@dev_user',
      userId: 123456,
      firstName: 'Dev',
      lastName: '',
    })
    await harness.app.close()
  })

  test('does not grant access when player registration fails', async () => {
    const harness = await createHarness()
    const error = new Error('database unavailable')
    harness.playersRepository.upsert.mockRejectedValue(error)

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/direct',
      headers: authHeader('alice'),
      payload: { opponent: '@bob' },
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'player_registration_failed' })
    expect(harness.context.directMatch.execute).not.toHaveBeenCalled()
    expect(harness.log.error).toHaveBeenCalledWith(
      'Не удалось зарегистрировать игрока из webapp',
      { username: '@alice', message: error.message }
    )
    await harness.app.close()
  })

  test('does not mutate state or announce stale and unauthorized direct actions', async () => {
    const harness = await createHarness({ production: true })
    const invite = await harness.invitesStore.create({
      player: '@alice',
      opponent: '@bob',
      createdAt: Date.now(),
    })

    const requests = [
      { url: '/api/direct/accept', payload: { inviteId: invite.inviteId } },
      { url: '/api/direct/decline', payload: { inviteId: invite.inviteId } },
      { url: '/api/direct/cancel', payload: { inviteId: invite.inviteId } },
    ]
    for (const request of requests) {
      const response = await harness.app.inject({
        method: 'POST',
        ...request,
        headers: authHeader('mallory', 99),
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ ok: false, reason: 'invite_not_found' })
    }

    expect(harness.context.addMatch.execute).not.toHaveBeenCalled()
    expect(harness.context.cancelSearch.execute).not.toHaveBeenCalled()
    expect(harness.bot.sendMessage).not.toHaveBeenCalled()
    expect(harness.sseManager.broadcast).not.toHaveBeenCalled()
    expect(await harness.invitesStore.getAll()).toHaveLength(1)
    await harness.app.close()
  })

  test('accepts an invite only for its target', async () => {
    const harness = await createHarness({ production: true })
    const invite = await harness.invitesStore.create({
      player: '@alice',
      opponent: '@bob',
      createdAt: Date.now(),
    })

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/direct/accept',
      headers: authHeader('bob', 2),
      payload: { inviteId: invite.inviteId },
    })

    expect(response.json()).toEqual({ ok: true })
    expect(harness.context.addMatch.execute).toHaveBeenCalledWith('@alice', '@bob', {
      scheduleLifecycle: true,
    })
    expect(await harness.invitesStore.getAll()).toEqual([])
    expect(harness.bot.sendMessage).toHaveBeenCalledTimes(1)
    await harness.app.close()
  })

  test('does not create or overwrite an invite on a repeated request', async () => {
    const harness = await createHarness({ production: true })
    const first = await harness.app.inject({
      method: 'POST',
      url: '/api/direct',
      headers: authHeader('alice', 10),
      payload: { opponent: 'bob' },
    })
    const storedAfterFirst = await harness.invitesStore.getAll()

    const second = await harness.app.inject({
      method: 'POST',
      url: '/api/direct',
      headers: authHeader('alice', 10),
      payload: { opponent: '@bob' },
    })

    expect(first.json()).toEqual({ ok: true })
    expect(second.json()).toEqual({ ok: false, reason: 'invite_exists' })
    expect(harness.context.directMatch.execute).toHaveBeenCalledTimes(1)
    expect(await harness.invitesStore.getAll()).toEqual(storedAfterFirst)
    expect(harness.bot.sendMessage).toHaveBeenCalledTimes(1)
    await harness.app.close()
  })

  test('consumes a parallel accept race exactly once', async () => {
    const harness = await createHarness({ production: true })
    const invite = await harness.invitesStore.create({ player: '@alice', opponent: '@bob' })

    const responses = await Promise.all(
      Array.from({ length: 4 }, () => harness.app.inject({
        method: 'POST',
        url: '/api/direct/accept',
        headers: authHeader('bob', 2),
        payload: { inviteId: invite.inviteId },
      }))
    )

    expect(responses.filter((response) => response.json().ok)).toHaveLength(1)
    expect(responses.filter((response) => response.json().reason === 'invite_not_found')).toHaveLength(3)
    expect(harness.context.addMatch.execute).toHaveBeenCalledTimes(1)
    await harness.app.close()
  })

  test('does not treat invite storage failure as not found or mutate the queue', async () => {
    const harness = await createHarness({ production: true })
    harness.invitesStore.consume = jest.fn().mockRejectedValue(new Error('redis unavailable'))

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/direct/accept',
      headers: authHeader('bob', 2),
      payload: { inviteId: 'Abcdefgh12345678' },
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'invite_storage_unavailable' })
    expect(harness.context.addMatch.execute).not.toHaveBeenCalled()
    await harness.app.close()
  })
})
