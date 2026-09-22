import { createHmac } from 'node:crypto'
import Fastify from 'fastify'
import { jest } from '@jest/globals'
import { registerRoutes } from '#interfaces/webapp/router.js'
import { InMemoryInvitesStore } from '#infrastructure/invites/InMemoryInvitesStore.js'
import { InMemoryPlayersRepository } from '#infrastructure/players/InMemoryPlayersRepository.js'
import { SseManager } from '#interfaces/webapp/sse.js'
import { QueueState } from '#domain/entities/QueueState.js'
import { createTestIdentityHelper } from '#application/usecases/createTestIdentityHelper.js'

const token = 'webapp-test-token'

const initDataFor = (user, { authDate = Math.floor(Date.now() / 1000) } = {}) => {
  const params = new URLSearchParams({ auth_date: String(authDate), user: JSON.stringify(user) })
  const dataCheckString = Array.from(params.entries())
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secretKey = createHmac('sha256', 'WebAppData').update(token).digest()
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
  params.set('hash', hash)
  return params.toString()
}

const createHarness = async ({
  production = false,
  claimPlayerIdentity = undefined,
  applyPauseMode = jest.fn(),
  playersRepository: playersRepositoryOverride = undefined,
  sseManager: sseManagerOverride = undefined,
} = {}) => {
  process.env.NODE_ENV = production ? 'production' : 'test'

  let currentState = new QueueState({
    queue: [],
    searching: [],
    played: [],
    ownership: { '@bob': { userId: 2, generation: 1, status: 'active' } },
  })
  let revision = 0
  const repository = {
    get: jest.fn(async () => currentState),
    save: jest.fn(async (nextState) => { currentState = nextState }),
    getVersioned: jest.fn(async () => ({ state: currentState, revision })),
    saveIfRevision: jest.fn(async (expectedRevision, nextState) => {
      if (expectedRevision !== revision) return false
      currentState = nextState
      revision += 1
      return true
    }),
  }
  const invitesStore = new InMemoryInvitesStore()
  const rawInviteCreate = invitesStore.create.bind(invitesStore)
  invitesStore.create = (input, opponent, createdAt) => {
    if (input && typeof input === 'object' && !input.playerIdentity && !input.opponentIdentity) {
      const userIdFor = (username) => ({ '@alice': 1, '@bob': 2, '@banned': 3, '@old': 42, '@new': 42 }[username] || `test:${username}`)
      input = {
        ...input,
        playerIdentity: { username: input.player, userId: userIdFor(input.player), generation: 1 },
        opponentIdentity: { username: input.opponent, userId: userIdFor(input.opponent), generation: 1 },
      }
    }
    return rawInviteCreate(input, opponent, createdAt)
  }
  const playersRepository = playersRepositoryOverride || {
    upsert: jest.fn().mockResolvedValue(undefined),
    isBanned: jest.fn().mockResolvedValue(false),
    findOne: jest.fn().mockResolvedValue(null),
    getAliases: jest.fn().mockResolvedValue([]),
    setBanned: jest.fn().mockResolvedValue(true),
    findAll: jest.fn().mockResolvedValue([]),
    // Default true (permissive), mirroring isBanned's default false: most
    // existing tests exercise gameplay endpoints that are now also gated by
    // requireVerified and don't care about verification itself — only the
    // dedicated registration/requireVerified tests override this to false.
    isVerified: jest.fn().mockResolvedValue(true),
    setVerified: jest.fn().mockResolvedValue(true),
  }
  const activateIdentity = createTestIdentityHelper({ queueRepository: repository, playersRepository })
  const testIdentityActivation = jest.fn((input) => activateIdentity(input))
  const context = {
    testIdentityActivation,
    repository,
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
    ...(claimPlayerIdentity ? { claimPlayerIdentity } : {}),
  }
  const bot = {
    sendMessage: jest.fn().mockResolvedValue(undefined),
    deleteMessage: jest.fn().mockResolvedValue(undefined),
    editMessageText: jest.fn().mockResolvedValue(undefined),
    editMessageReplyMarkup: jest.fn().mockResolvedValue(undefined),
    getChatMember: jest.fn(),
    getChatAdministrators: jest.fn().mockResolvedValue([]),
  }
  const sseManager = sseManagerOverride
    || { addClient: jest.fn(), broadcast: jest.fn(), notifyUser: jest.fn() }
  const log = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
  const messages = {
    directInvite: jest.fn().mockReturnValue('invite'),
    directInviteSent: jest.fn().mockReturnValue('invite sent'),
    directAccepted: jest.fn().mockReturnValue('accepted'),
    directDeclined: jest.fn().mockReturnValue('declined'),
    directCancelled: jest.fn().mockReturnValue('cancelled'),
    searchAdded: jest.fn().mockReturnValue('search added'),
    searchAccepted: jest.fn().mockReturnValue('search accepted'),
    searchCancelled: jest.fn().mockReturnValue('search cancelled'),
    matchAlreadyInQueue: jest.fn().mockReturnValue('invite exists'),
    playerBanned: jest.fn().mockReturnValue('you are banned'),
    playerUnbanned: jest.fn().mockReturnValue('you are unbanned'),
    registrationRequest: jest.fn().mockReturnValue('please confirm'),
    registrationConfirmed: jest.fn().mockReturnValue('confirmed'),
  }
  // forceCloseConnections: the GET /api/events tests below open a real
  // socket via app.listen() and never end the response (it's a long-lived
  // SSE stream, by design) — without this, app.close() would hang waiting
  // for that connection to finish on its own.
  const app = Fastify({ forceCloseConnections: true })

  await registerRoutes(app, {
    bot,
    getContext: () => context,
    queueChatId: 'queue-chat',
    sseManager,
    isPauseModeEnabled: () => false,
    setPauseMode: jest.fn(),
    emergeStateByChat: new Map(),
    applyPauseMode,
    resumeEmergeAfterContinue: jest.fn(),
    resumeQueueAfterPause: jest.fn(),
    handleEmerge: jest.fn(),
    messages,
    ui: { inline: { directAccept: 'accept', directDecline: 'decline', directCancel: 'cancel', confirmRegistration: 'confirm' } },
    log,
    playersRepository,
    invitesStore,
  })

  return {
    app,
    bot,
    context,
    invitesStore,
    log,
    messages,
    playersRepository,
    get state() { return currentState },
    sseManager,
  }
}

// GET /api/events hijacks the raw response and never ends it (it's a
// long-lived SSE stream), so app.inject() — which waits for the response to
// finish — would hang forever. Listening on a real ephemeral port and
// reading with fetch() exercises the exact same path a real EventSource
// does (URL-encoding, Fastify's query parsing, hijack, headers) without any
// internal Fastify API to fall out of sync with. The initial state_update
// and a conditional player_banned are two separate writes, so this collects
// everything that arrives within a short grace window rather than just the
// first chunk — long enough for both, short enough to keep tests fast.
const readSseChunks = async (app, path, graceMs = 200) => {
  const address = await app.listen({ port: 0, host: '127.0.0.1' })
  const res = await fetch(`${address}${path}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const deadline = Date.now() + graceMs
  for (;;) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    const timeout = new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), remaining))
    const result = await Promise.race([reader.read(), timeout])
    if (result.timedOut || result.done) break
    buffer += decoder.decode(result.value, { stream: true })
  }
  await reader.cancel().catch(() => {})
  return buffer
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

  test('activates a test identity before granting route access', async () => {
    const harness = await createHarness()
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/direct',
      headers: authHeader('alice', 10),
      payload: { opponent: '@bob' },
    })

    expect(response.statusCode).toBe(200)
    expect(harness.context.testIdentityActivation).toHaveBeenCalledWith({ username: '@alice', userId: 10 })
    await harness.app.close()
  })

  test('sends recipient controls privately and a separate cancel confirmation to the initiator', async () => {
    const harness = await createHarness({ production: true })
    harness.playersRepository.findOne.mockImplementation(async (username) =>
      username === '@bob' ? { username, userId: 42, generation: 1 } : null
    )

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/direct',
      headers: authHeader('alice', 10),
      payload: { opponent: '@bob' },
    })

    expect(response.statusCode).toBe(200)
    // Прямое приглашение не анонсируется в общий чат: обе стороны получают сообщения в ЛС.
    expect(harness.bot.sendMessage).toHaveBeenCalledTimes(2)
    expect(harness.bot.sendMessage.mock.calls[0][0]).toBe(2)
    expect(harness.bot.sendMessage.mock.calls[0][2].reply_markup.inline_keyboard).toHaveLength(1)
    expect(harness.bot.sendMessage.mock.calls[1][0]).toBe(10)
    expect(harness.bot.sendMessage.mock.calls[1][2].reply_markup.inline_keyboard[0][0].callback_data)
      .toMatch(/^direct_cancel:/)
    await harness.app.close()
  })

  test('cancelling an unaccepted direct invite does not announce it in the group chat', async () => {
    const harness = await createHarness({ production: true })
    harness.playersRepository.findOne.mockImplementation(async (username) =>
      username === '@bob' ? { username, userId: 2, generation: 1 } : null
    )

    const createResponse = await harness.app.inject({
      method: 'POST',
      url: '/api/direct',
      headers: authHeader('alice', 10),
      payload: { opponent: '@bob' },
    })
    expect(createResponse.statusCode).toBe(200)
    const [invite] = await harness.invitesStore.getAll()
    harness.bot.sendMessage.mockClear()

    const cancelResponse = await harness.app.inject({
      method: 'POST',
      url: '/api/direct/cancel',
      headers: authHeader('alice', 10),
      payload: { inviteId: invite.inviteId },
    })

    expect(cancelResponse.json()).toEqual({ ok: true })
    // Отменённое (не принятое) приглашение — личное дело двоих, в общий чат ничего не летит.
    // Целевой игрок узнаёт об отмене личным сообщением от бота.
    expect(harness.bot.sendMessage).toHaveBeenCalledTimes(1)
    expect(harness.bot.sendMessage).toHaveBeenCalledWith(2, 'cancelled')
    expect(await harness.invitesStore.getAll()).toEqual([])
    await harness.app.close()
  })

  test('cancelling an outgoing invite through DELETE /api/search still stays silent', async () => {
    const harness = await createHarness({ production: true })
    harness.playersRepository.findOne.mockImplementation(async (username) =>
      username === '@bob' ? { username, userId: 2, generation: 1 } : null
    )

    // Клиент может дёрнуть общий /api/search вместо /api/direct/cancel (старая
    // сборка мини-аппа, прямой вызов API) — инициатор приглашения всё равно
    // числится в общем поиске на бэкенде. Это не должно ни утечь в чат, ни
    // оставить приглашение висеть.
    const createResponse = await harness.app.inject({
      method: 'POST',
      url: '/api/direct',
      headers: authHeader('alice', 10),
      payload: { opponent: '@bob' },
    })
    expect(createResponse.statusCode).toBe(200)
    harness.bot.sendMessage.mockClear()

    const deleteResponse = await harness.app.inject({
      method: 'DELETE',
      url: '/api/search',
      headers: authHeader('alice', 10),
    })

    expect(deleteResponse.json()).toEqual({ ok: true, status: 'removed' })
    // Общий чат остаётся в стороне — уведомление уходит только целевому игроку в ЛС.
    expect(harness.bot.sendMessage).toHaveBeenCalledTimes(1)
    expect(harness.bot.sendMessage).toHaveBeenCalledWith(2, 'cancelled')
    expect(await harness.invitesStore.getAll()).toEqual([])
    await harness.app.close()
  })

  test('declining a direct invite does not announce it in the group chat', async () => {
    const harness = await createHarness({ production: true })
    harness.playersRepository.findOne.mockImplementation(async (username) =>
      username === '@bob' ? { username, userId: 2, generation: 1 } : null
    )

    await harness.app.inject({
      method: 'POST',
      url: '/api/direct',
      headers: authHeader('alice', 10),
      payload: { opponent: '@bob' },
    })
    const [invite] = await harness.invitesStore.getAll()
    harness.bot.sendMessage.mockClear()

    const declineResponse = await harness.app.inject({
      method: 'POST',
      url: '/api/direct/decline',
      headers: authHeader('bob', 2),
      payload: { inviteId: invite.inviteId },
    })

    expect(declineResponse.json()).toEqual({ ok: true })
    // Отклонённое приглашение так и не стало матчем — в общий чат ничего не летит.
    // Инициатор узнаёт об отказе личным сообщением от бота.
    expect(harness.bot.sendMessage).toHaveBeenCalledTimes(1)
    expect(harness.bot.sendMessage).toHaveBeenCalledWith(10, 'declined')
    expect(await harness.invitesStore.getAll()).toEqual([])
    await harness.app.close()
  })

  test('does not cancel another concurrent direct request search', async () => {
    const harness = await createHarness({ production: true })
    harness.playersRepository.findOne.mockImplementation(async (username) =>
      username === '@bob' ? { username, userId: 2, generation: 1 } : null
    )
    harness.context.directMatch.execute
      .mockResolvedValueOnce({ ok: true, searchStatus: 'added' })
      .mockResolvedValueOnce({ ok: true, searchStatus: 'already_searching' })

    const [first, second] = await Promise.all([
      harness.app.inject({
        method: 'POST',
        url: '/api/direct',
        headers: authHeader('alice', 10),
        payload: { opponent: '@bob' },
      }),
      harness.app.inject({
        method: 'POST',
        url: '/api/direct',
        headers: authHeader('alice', 10),
        payload: { opponent: '@bob' },
      }),
    ])

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    expect(harness.context.cancelSearch.execute).not.toHaveBeenCalled()
    await harness.app.close()
  })

  test('does not cancel an existing search when invite storage fails', async () => {
    const harness = await createHarness({ production: true })
    harness.playersRepository.findOne.mockImplementation(async (username) =>
      username === '@bob' ? { username, userId: 2, generation: 1 } : null
    )
    harness.state.searching.push('@alice')
    harness.state.searchingIdentities = {
      '@alice': { username: '@alice', userId: 10, generation: 1 },
    }
    harness.context.directMatch.execute.mockResolvedValue({
      ok: true,
      searchStatus: 'already_searching',
    })
    jest.spyOn(harness.invitesStore, 'create').mockRejectedValue(new Error('storage unavailable'))

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/direct',
      headers: authHeader('alice', 10),
      payload: { opponent: '@bob' },
    })

    expect(response.statusCode).toBe(503)
    expect(harness.context.cancelSearch.execute).not.toHaveBeenCalled()
    await harness.app.close()
  })

  test('activates the development fallback user', async () => {
    const harness = await createHarness()
    const response = await harness.app.inject({ method: 'POST', url: '/api/search' })

    expect(response.statusCode).toBe(200)
    expect(harness.context.testIdentityActivation).toHaveBeenCalledWith({ username: '@dev_user', userId: 123456 })
    await harness.app.close()
  })

  test('seeds @dev_user under the real DEV_USER_ID so a later dev-fallback claim does not lose verification', async () => {
    // Regression for a real bug found via manual testing: DEV_PLAYERS' entry
    // for @dev_user has no explicit userId, so without this fix it would
    // seed under a synthetic test-user:@dev_user id (createTestIdentityHelper's
    // fallback). Any authenticated request from the mini-app without initData
    // later claims @dev_user under the real DEV_USER_ID (123456) — a
    // different id — and InMemoryPlayersRepository.upsert() treats that as
    // the username changing owners: it detaches the seeded (verified) record
    // and starts a fresh, unverified one (also breaking generation and any
    // pendingInvites identity referencing the old id). Seeding under the same
    // DEV_USER_ID up front means there's no owner change to lose anything to.
    const playersRepository = new InMemoryPlayersRepository()
    const harness = await createHarness({ playersRepository })

    const seedResponse = await harness.app.inject({
      method: 'POST',
      url: '/api/dev/seed',
      payload: { players: [{ username: '@dev_user', firstName: 'Dev' }] },
    })
    expect(seedResponse.statusCode).toBe(200)
    await expect(playersRepository.findOne('@dev_user')).resolves.toMatchObject({
      userId: 123456,
      verified: true,
    })

    // Первый же authenticated-запрос без initData claim'ит @dev_user под тем
    // же DEV_USER_ID — владелец не меняется, verified не теряется.
    const response = await harness.app.inject({ method: 'POST', url: '/api/search' })

    expect(response.statusCode).toBe(200)
    await expect(playersRepository.isVerified('@dev_user')).resolves.toBe(true)
    await harness.app.close()
  })

  test('cleans only the old identity token after a username transition', async () => {
    const harness = await createHarness({ production: true })
    harness.state.ownership['@old'] = { userId: 10, generation: 1, status: 'active' }
    harness.state.ownership['@new'] = { userId: 10, generation: 2, status: 'active' }
    harness.state.searching.push('@old', '@new')
    harness.state.searchingIdentities = {
      '@old': { username: '@old', userId: 10, generation: 1 },
      '@new': { username: '@new', userId: 10, generation: 2 },
    }
    await harness.invitesStore.create({
      inviteId: 'old-token-invite',
      player: '@old',
      opponent: '@bob',
      playerIdentity: { username: '@old', userId: 10, generation: 1 },
      opponentIdentity: { username: '@bob', userId: 2, generation: 1 },
      createdAt: Date.now(),
    })

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/search',
      headers: authHeader('new', 10),
    })

    expect(response.statusCode).toBe(200)
    expect(await harness.invitesStore.getAll()).toEqual([])
    expect(harness.state.searching).toEqual(['@new'])
    expect(harness.state.ownership['@old'].status).toBe('inactive')
    expect(harness.state.ownership['@new']).toMatchObject({ userId: 10, status: 'active' })
    await harness.app.close()
  })

  test('projects internal state and invite identities into a public REST/SSE DTO', async () => {
    const harness = await createHarness({ production: true })
    harness.state.queue.push({
      player1: '@alice',
      player2: '@bob',
      startDate: new Date('2026-01-01T12:00:00.000Z'),
      endDate: new Date('2026-01-01T12:30:00.000Z'),
      status: 'playing',
      participantIdentities: {
        '@alice': { username: '@alice', userId: 10, generation: 8 },
        '@bob': { username: '@bob', userId: 2, generation: 9 },
      },
    })
    harness.state.searching.push('@alice')
    harness.state.searchingIdentities = {
      '@alice': { username: '@alice', userId: 10, generation: 8 },
    }
    harness.state.played.push('@played')
    const invite = await harness.invitesStore.create({
      player: '@alice',
      opponent: '@bob',
      playerIdentity: { username: '@alice', userId: 10, generation: 8 },
      opponentIdentity: { username: '@bob', userId: 2, generation: 9 },
    })

    const response = await harness.app.inject({ method: 'GET', url: '/api/state' })
    const publicState = response.json()

    expect(publicState).toEqual({
      queue: [{
        player1: '@alice',
        player2: '@bob',
        startDate: '2026-01-01T12:00:00.000Z',
        endDate: '2026-01-01T12:30:00.000Z',
        status: 'playing',
      }],
      searching: ['@alice'],
      played: ['@played'],
      paused: false,
      emergeActive: false,
      serverTime: '2026-01-01T00:00:00.000Z',
      revision: 0,
      pendingInvites: [{
        inviteId: invite.inviteId,
        player: '@alice',
        opponent: '@bob',
        createdAt: expect.any(Number),
        expiresAt: expect.any(Number),
      }],
    })
    expect(JSON.stringify(publicState)).not.toMatch(
      /userId|generation|participantIdentities|playerIdentity|opponentIdentity/
    )

    await harness.app.inject({
      method: 'POST',
      url: '/api/search',
      headers: authHeader('alice', 10),
    })
    const emittedState = JSON.parse(JSON.stringify(harness.sseManager.broadcast.mock.calls.at(-1)[1]))
    // Тот же публичный DTO, за исключением revision: аутентификация alice
    // между двумя снимками сама пишет identity claim в состояние очереди
    // (см. auth-preHandler), поэтому revision закономерно продвигается вперёд
    // даже там, где registerSearch — заглушка, не трогающая репозиторий.
    const { revision: initialRevision, ...publicStateWithoutRevision } = publicState
    const { revision: emittedRevision, ...emittedStateWithoutRevision } = emittedState
    expect(emittedStateWithoutRevision).toEqual(publicStateWithoutRevision)
    expect(emittedRevision).toBeGreaterThan(initialRevision)
    await harness.app.close()
  })

  test('whitelists public player fields and strips repository internals', async () => {
    const harness = await createHarness()
    harness.playersRepository.findAll.mockResolvedValue([{
      username: '@alice',
      displayName: 'Alice',
      firstName: 'Alice',
      lastName: 'Player',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
      banned: true,
      userId: 10,
      generation: 4,
      identityVersion: 4,
      usernames: ['@old-alice'],
      claimToken: 'private',
      _id: 'mongo-id',
    }, {
      username: '@__former_42',
      userId: 42,
      banned: true,
    }])

    const response = await harness.app.inject({ method: 'GET', url: '/api/players' })

    expect(response.json()).toEqual({
      players: [{
        username: '@alice',
        displayName: 'Alice',
        firstName: 'Alice',
        lastName: 'Player',
        lastSeenAt: '2026-01-01T00:00:00.000Z',
        banned: true,
        verified: false,
        isAdmin: false,
      }],
    })
    expect(JSON.stringify(response.json())).not.toMatch(
      /userId|generation|identityVersion|usernames|claimToken|_id/
    )
    await harness.app.close()
  })

  test('returns a normalized ban flag without userId in the player list', async () => {
    const harness = await createHarness()
    harness.playersRepository.findAll.mockResolvedValue([
      { username: '@alice', userId: 10, banned: true },
      { username: '@bob', userId: 11 },
    ])

    const response = await harness.app.inject({ method: 'GET', url: '/api/players' })

    expect(response.json()).toEqual({
      players: [
        { username: '@alice', banned: true, verified: false, isAdmin: false },
        { username: '@bob', banned: false, verified: false, isAdmin: false },
      ],
    })
    await harness.app.close()
  })

  test('does not grant access when player registration fails', async () => {
    const harness = await createHarness()
    const error = new Error('database unavailable')
    harness.context.testIdentityActivation.mockRejectedValue(error)

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/direct',
      headers: authHeader('alice'),
      payload: { opponent: '@bob' },
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'player_identity_unavailable' })
    expect(harness.context.directMatch.execute).not.toHaveBeenCalled()
    expect(harness.log.error).toHaveBeenCalledWith(
      'Не удалось подтвердить identity игрока из webapp',
      { username: '@alice', message: error.message }
    )
    await harness.app.close()
  })

  test('returns retriable 503 when failed claim transition cleanup fails', async () => {
    const error = Object.assign(new Error('database unavailable'), {
      transitions: [{ username: '@old', userId: 10, generation: 1 }],
    })
    const claimPlayerIdentity = { execute: jest.fn().mockRejectedValue(error) }
    const harness = await createHarness({ claimPlayerIdentity })
    harness.invitesStore.deleteByParticipant = jest.fn().mockRejectedValue(new Error('redis unavailable'))

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/search',
      headers: authHeader('new', 10),
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'identity_cleanup_unavailable' })
    expect(harness.context.registerSearch.execute).not.toHaveBeenCalled()
    await harness.app.close()
  })

  test('cleans exact transition references before returning failed claim status', async () => {
    const transition = { username: '@old', userId: 10, generation: 1 }
    const error = Object.assign(new Error('database unavailable'), { transitions: [transition] })
    const claimPlayerIdentity = { execute: jest.fn().mockRejectedValue(error) }
    const harness = await createHarness({ claimPlayerIdentity })
    await harness.invitesStore.create({
      player: '@old',
      opponent: '@bob',
      playerIdentity: transition,
      opponentIdentity: { username: '@bob', userId: 2, generation: 1 },
    })

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/search',
      headers: authHeader('new', 10),
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'player_identity_unavailable' })
    expect(await harness.invitesStore.getAll()).toEqual([])
    expect(harness.context.registerSearch.execute).not.toHaveBeenCalled()
    await harness.app.close()
  })

  test('returns retriable 503 when successful claim transition cleanup fails', async () => {
    const claimPlayerIdentity = {
      execute: jest.fn().mockResolvedValue({
        ok: true,
        username: '@new',
        userId: 10,
        generation: 2,
        transitions: [{ username: '@old', userId: 10, generation: 1 }],
      }),
    }
    const harness = await createHarness({ claimPlayerIdentity })
    harness.invitesStore.deleteByParticipant = jest.fn().mockRejectedValue(new Error('redis unavailable'))

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/search',
      headers: authHeader('new', 10),
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'identity_cleanup_unavailable' })
    expect(harness.context.registerSearch.execute).not.toHaveBeenCalled()
    await harness.app.close()
  })

  test('returns player_banned before executing an authenticated use case', async () => {
    const harness = await createHarness({ production: true })
    harness.playersRepository.isBanned.mockResolvedValue(true)

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/search',
      headers: authHeader('alice', 10),
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'player_banned' })
    expect(harness.context.testIdentityActivation).toHaveBeenCalled()
    expect(harness.playersRepository.isBanned).toHaveBeenCalledWith(10)
    expect(harness.context.registerSearch.execute).not.toHaveBeenCalled()
    await harness.app.close()
  })

  test('rejects initData older than the max age instead of trusting it forever', async () => {
    const harness = await createHarness({ production: true })

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/search',
      headers: {
        'x-telegram-init-data': initDataFor(
          { id: 1, username: 'alice', first_name: 'Alice' },
          { authDate: Math.floor(Date.now() / 1000) - 25 * 60 * 60 }
        ),
      },
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'stale_init_data' })
    expect(harness.context.registerSearch.execute).not.toHaveBeenCalled()
    await harness.app.close()
  })

  test('returns not_verified before executing an authenticated use case', async () => {
    const harness = await createHarness({ production: true })
    harness.playersRepository.isVerified.mockResolvedValue(false)

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/search',
      headers: authHeader('alice', 10),
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'not_verified' })
    expect(harness.playersRepository.isVerified).toHaveBeenCalledWith(10)
    expect(harness.context.registerSearch.execute).not.toHaveBeenCalled()
    await harness.app.close()
  })

  test('grants the METRICS_CHAT_ID owner unconditional access without checking the repository', async () => {
    const previousOwnerId = process.env.METRICS_CHAT_ID
    process.env.METRICS_CHAT_ID = '10'
    try {
      const harness = await createHarness({ production: true })
      harness.playersRepository.isVerified.mockResolvedValue(false)

      const response = await harness.app.inject({
        method: 'POST',
        url: '/api/search',
        headers: authHeader('owner', 10),
      })

      expect(response.statusCode).toBe(200)
      expect(harness.playersRepository.isVerified).not.toHaveBeenCalled()
      await harness.app.close()
    } finally {
      if (previousOwnerId === undefined) delete process.env.METRICS_CHAT_ID
      else process.env.METRICS_CHAT_ID = previousOwnerId
    }
  })

  describe('POST /api/register', () => {
    test('sends a chat confirmation request when the player is not yet verified', async () => {
      const harness = await createHarness({ production: true })
      harness.playersRepository.isVerified.mockResolvedValue(false)
      harness.bot.getChatMember.mockResolvedValue({ status: 'member' })
      harness.bot.sendMessage.mockResolvedValue({ message_id: 1 })

      const response = await harness.app.inject({
        method: 'POST',
        url: '/api/register',
        headers: authHeader('alice', 10),
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ ok: true, alreadyVerified: false, cooldown: false })
      expect(harness.bot.sendMessage).toHaveBeenCalledTimes(1)
      expect(harness.bot.sendMessage.mock.calls[0][0]).toBe('queue-chat')
      const keyboard = harness.bot.sendMessage.mock.calls[0][2].reply_markup
      expect(keyboard.inline_keyboard[0][0].callback_data).toBe('confirm_player:10')
      await harness.app.close()
    })

    test('does not send a message when the player is already verified', async () => {
      const harness = await createHarness({ production: true })
      harness.playersRepository.isVerified.mockResolvedValue(true)

      const response = await harness.app.inject({
        method: 'POST',
        url: '/api/register',
        headers: authHeader('alice', 10),
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ ok: true, alreadyVerified: true })
      expect(harness.bot.sendMessage).not.toHaveBeenCalled()
      // Already verified short-circuits before the membership check too.
      expect(harness.bot.getChatMember).not.toHaveBeenCalled()
      await harness.app.close()
    })

    test('the METRICS_CHAT_ID owner never gets a chat message either', async () => {
      const previousOwnerId = process.env.METRICS_CHAT_ID
      process.env.METRICS_CHAT_ID = '10'
      try {
        const harness = await createHarness({ production: true })
        harness.playersRepository.isVerified.mockResolvedValue(false)

        const response = await harness.app.inject({
          method: 'POST',
          url: '/api/register',
          headers: authHeader('owner', 10),
        })

        expect(response.statusCode).toBe(200)
        expect(response.json()).toEqual({ ok: true, alreadyVerified: true })
        expect(harness.bot.sendMessage).not.toHaveBeenCalled()
        await harness.app.close()
      } finally {
        if (previousOwnerId === undefined) delete process.env.METRICS_CHAT_ID
        else process.env.METRICS_CHAT_ID = previousOwnerId
      }
    })

    test('rejects a request from someone who is not a member of the chat', async () => {
      // Otherwise anyone who has ever opened a DM with the bot — no chat
      // membership required for that — could spam the group with requests.
      const harness = await createHarness({ production: true })
      harness.playersRepository.isVerified.mockResolvedValue(false)
      harness.bot.getChatMember.mockResolvedValue({ status: 'left' })

      const response = await harness.app.inject({
        method: 'POST',
        url: '/api/register',
        headers: authHeader('alice', 10),
      })

      expect(response.statusCode).toBe(403)
      expect(response.json()).toEqual({ error: 'not_chat_member' })
      expect(harness.bot.sendMessage).not.toHaveBeenCalled()
      await harness.app.close()
    })

    test('returns 503 when the membership check itself fails', async () => {
      const harness = await createHarness({ production: true })
      harness.playersRepository.isVerified.mockResolvedValue(false)
      harness.bot.getChatMember.mockRejectedValue(new Error('Telegram is down'))

      const response = await harness.app.inject({
        method: 'POST',
        url: '/api/register',
        headers: authHeader('alice', 10),
      })

      expect(response.statusCode).toBe(503)
      expect(response.json()).toEqual({ error: 'chat_membership_check_failed' })
      expect(harness.bot.sendMessage).not.toHaveBeenCalled()
      await harness.app.close()
    })

    test('does not resend within the cooldown window', async () => {
      const harness = await createHarness({ production: true })
      harness.playersRepository.isVerified.mockResolvedValue(false)
      harness.bot.getChatMember.mockResolvedValue({ status: 'member' })
      harness.bot.sendMessage.mockResolvedValue({ message_id: 1 })

      const first = await harness.app.inject({
        method: 'POST',
        url: '/api/register',
        headers: authHeader('alice', 10),
      })
      expect(first.json()).toEqual({ ok: true, alreadyVerified: false, cooldown: false })

      const second = await harness.app.inject({
        method: 'POST',
        url: '/api/register',
        headers: authHeader('alice', 10),
      })

      expect(second.statusCode).toBe(200)
      expect(second.json()).toEqual({ ok: true, alreadyVerified: false, cooldown: true })
      expect(harness.bot.sendMessage).toHaveBeenCalledTimes(1)
      await harness.app.close()
    })

    test('returns 503 when the chat notification fails', async () => {
      const harness = await createHarness({ production: true })
      harness.playersRepository.isVerified.mockResolvedValue(false)
      harness.bot.getChatMember.mockResolvedValue({ status: 'member' })
      harness.bot.sendMessage.mockRejectedValue(new Error('Telegram is down'))

      const response = await harness.app.inject({
        method: 'POST',
        url: '/api/register',
        headers: authHeader('alice', 10),
      })

      expect(response.statusCode).toBe(503)
      expect(response.json()).toEqual({ error: 'registration_request_failed' })
      await harness.app.close()
    })

    test('auto-verifies in dev mode instead of requiring a real chat button press', async () => {
      // production: false => isDev true => notifyChat is a no-op that never
      // calls bot.sendMessage, and there is no real message for anyone to
      // press a button on — so /api/register itself verifies the player,
      // mirroring how /api/dev/seed does the same for mock-mode fixtures.
      const harness = await createHarness({ production: false })
      harness.playersRepository.isVerified.mockResolvedValue(false)

      const response = await harness.app.inject({
        method: 'POST',
        url: '/api/register',
        headers: authHeader('alice', 10),
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ ok: true, alreadyVerified: true })
      expect(harness.bot.sendMessage).not.toHaveBeenCalled()
      expect(harness.playersRepository.setVerified).toHaveBeenCalledWith('@alice', true)
      // Dev auto-verify must short-circuit before any real Telegram call —
      // a dev tunnel may have no working bot/chat to check membership on.
      expect(harness.bot.getChatMember).not.toHaveBeenCalled()
      await harness.app.close()
    })

    test('checks the cooldown before the chat membership, to avoid wasting a Telegram API call on a repeat tap', async () => {
      const harness = await createHarness({ production: true })
      harness.playersRepository.isVerified.mockResolvedValue(false)
      harness.bot.getChatMember.mockResolvedValue({ status: 'member' })
      harness.bot.sendMessage.mockResolvedValue({ message_id: 1 })

      await harness.app.inject({ method: 'POST', url: '/api/register', headers: authHeader('alice', 10) })
      harness.bot.getChatMember.mockClear()

      const second = await harness.app.inject({
        method: 'POST',
        url: '/api/register',
        headers: authHeader('alice', 10),
      })

      expect(second.json()).toEqual({ ok: true, alreadyVerified: false, cooldown: true })
      expect(harness.bot.getChatMember).not.toHaveBeenCalled()
      await harness.app.close()
    })
  })

  test('POST /api/admin/pause reports a conflict instead of a false "ok" when applyPauseMode cannot commit', async () => {
    const applyPauseMode = jest.fn().mockResolvedValue({ hasQueue: false, conflict: true })
    const harness = await createHarness({ production: true, applyPauseMode })
    harness.bot.getChatMember.mockResolvedValue({ status: 'administrator' })

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/admin/pause',
      headers: authHeader('admin', 10),
    })

    // Конфликт CAS не должен маскироваться под успех — мини-апп должен узнать,
    // что пауза не включилась, и предложить повторить попытку.
    expect(response.json()).toEqual({ ok: false, reason: 'conflict' })
    await harness.app.close()
  })

  test('POST /api/admin/pause reports ok when applyPauseMode commits successfully', async () => {
    const applyPauseMode = jest.fn().mockResolvedValue({ hasQueue: true })
    const harness = await createHarness({ production: true, applyPauseMode })
    harness.bot.getChatMember.mockResolvedValue({ status: 'administrator' })

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/admin/pause',
      headers: authHeader('admin', 10),
    })

    expect(response.json()).toEqual({ ok: true })
    await harness.app.close()
  })

  test('DELETE bans and PATCH unbans only existing players for admins', async () => {
    const harness = await createHarness({ production: true })
    harness.bot.getChatMember.mockResolvedValue({ status: 'administrator' })
    harness.playersRepository.setBanned.mockImplementation(async (username, banned) =>
      username === '@alice' && typeof banned === 'boolean'
    )

    const banResponse = await harness.app.inject({
      method: 'DELETE',
      url: '/api/players/alice',
      headers: authHeader('admin', 10),
    })
    const unbanResponse = await harness.app.inject({
      method: 'PATCH',
      url: '/api/players/alice',
      headers: authHeader('admin', 10),
      payload: { banned: false },
    })
    const missingResponse = await harness.app.inject({
      method: 'PATCH',
      url: '/api/players/missing',
      headers: authHeader('admin', 10),
      payload: { banned: false },
    })

    expect(banResponse.statusCode).toBe(200)
    expect(banResponse.json()).toEqual({ ok: true })
    expect(unbanResponse.statusCode).toBe(200)
    expect(unbanResponse.json()).toEqual({ ok: true, banned: false })
    expect(missingResponse.statusCode).toBe(404)
    expect(missingResponse.json()).toEqual({ error: 'player_not_found' })
    expect(harness.playersRepository.setBanned).toHaveBeenNthCalledWith(1, '@alice', true)
    expect(harness.playersRepository.setBanned).toHaveBeenNthCalledWith(2, '@alice', false)
    await harness.app.close()
  })

  test('PATCH ban removes the player from search and pending invites', async () => {
    const harness = await createHarness({ production: true })
    harness.bot.getChatMember.mockResolvedValue({ status: 'administrator' })
    harness.playersRepository.findOne.mockImplementation(async (username) =>
      username === '@alice' ? { username, userId: 42, banned: false } : null
    )
    harness.state.searching.push('@alice')
    harness.state.searchingIdentities = {
      '@alice': { username: '@alice', userId: 42, generation: 1 },
    }
    harness.state.ownership['@alice'] = { userId: 42, generation: 1, status: 'active' }
    await harness.invitesStore.create({
      inviteId: 'alice-invite',
      player: '@alice',
      opponent: '@bob',
      playerIdentity: { username: '@alice', userId: 42, generation: 1 },
      opponentIdentity: { username: '@bob', userId: 2, generation: 1 },
      createdAt: Date.now(),
    })

    const response = await harness.app.inject({
      method: 'PATCH',
      url: '/api/players/alice',
      headers: authHeader('admin', 10),
      payload: { banned: true },
    })

    expect(response.statusCode).toBe(200)
    expect(harness.state.searching).not.toContain('@alice')
    expect(await harness.invitesStore.getAll()).toEqual([])
    expect(harness.sseManager.broadcast).toHaveBeenCalledWith('state_update', expect.any(Object))
    await harness.app.close()
  })

  test('returns retriable 503 when ban cleanup fails after persistence', async () => {
    const harness = await createHarness({ production: true })
    harness.bot.getChatMember.mockResolvedValue({ status: 'administrator' })
    harness.playersRepository.findOne.mockImplementation(async (username) =>
      username === '@alice' ? { username, userId: 42, banned: false } : null
    )
    harness.invitesStore.deleteByParticipant = jest.fn().mockRejectedValue(new Error('redis unavailable'))

    const failed = await harness.app.inject({
      method: 'DELETE',
      url: '/api/players/alice',
      headers: authHeader('admin', 10),
    })

    expect(failed.statusCode).toBe(503)
    expect(failed.json()).toEqual({ error: 'ban_cleanup_unavailable' })
    expect(harness.playersRepository.setBanned).toHaveBeenCalledWith('@alice', true)

    harness.invitesStore.deleteByParticipant.mockResolvedValue(0)
    const retried = await harness.app.inject({
      method: 'DELETE',
      url: '/api/players/alice',
      headers: authHeader('admin', 10),
    })
    expect(retried.statusCode).toBe(200)
    await harness.app.close()
  })

  test('refuses to ban a player who is an administrator of the queue chat', async () => {
    const harness = await createHarness({ production: true })
    harness.bot.getChatMember.mockResolvedValue({ status: 'administrator' })
    harness.bot.getChatAdministrators.mockResolvedValue([{ user: { id: 42 } }])
    harness.playersRepository.findOne.mockImplementation(async (username) =>
      username === '@alice' ? { username, userId: 42, banned: false } : null
    )

    const deleteResponse = await harness.app.inject({
      method: 'DELETE',
      url: '/api/players/alice',
      headers: authHeader('admin', 10),
    })
    const patchResponse = await harness.app.inject({
      method: 'PATCH',
      url: '/api/players/alice',
      headers: authHeader('admin', 10),
      payload: { banned: true },
    })

    expect(deleteResponse.statusCode).toBe(403)
    expect(deleteResponse.json()).toEqual({ error: 'cannot_ban_admin' })
    expect(patchResponse.statusCode).toBe(403)
    expect(patchResponse.json()).toEqual({ error: 'cannot_ban_admin' })
    expect(harness.playersRepository.setBanned).not.toHaveBeenCalled()
    await harness.app.close()
  })

  test('still allows unbanning a player who is a chat administrator', async () => {
    const harness = await createHarness({ production: true })
    harness.bot.getChatMember.mockResolvedValue({ status: 'administrator' })
    harness.bot.getChatAdministrators.mockResolvedValue([{ user: { id: 42 } }])
    harness.playersRepository.findOne.mockImplementation(async (username) =>
      username === '@alice' ? { username, userId: 42, banned: true } : null
    )
    harness.playersRepository.setBanned.mockResolvedValue(true)

    const response = await harness.app.inject({
      method: 'PATCH',
      url: '/api/players/alice',
      headers: authHeader('admin', 10),
      payload: { banned: false },
    })

    expect(response.statusCode).toBe(200)
    expect(harness.playersRepository.setBanned).toHaveBeenCalledWith('@alice', false)
    await harness.app.close()
  })

  test('marks chat administrators in the player list', async () => {
    const harness = await createHarness()
    harness.bot.getChatAdministrators.mockResolvedValue([{ user: { id: 10 } }])
    harness.playersRepository.findAll.mockResolvedValue([
      { username: '@alice', userId: 10 },
      { username: '@bob', userId: 11 },
    ])

    const response = await harness.app.inject({ method: 'GET', url: '/api/players' })

    expect(response.json()).toEqual({
      players: [
        { username: '@alice', banned: false, verified: false, isAdmin: true },
        { username: '@bob', banned: false, verified: false, isAdmin: false },
      ],
    })
    await harness.app.close()
  })

  test('GET /api/players reports the METRICS_CHAT_ID owner as verified even without a stored record', async () => {
    // This is the mechanism that actually keeps the login screen off the
    // owner's screen — requireVerified (server-side gate) is defense in
    // depth, but the mini-app decides what to render from this DTO.
    const previousOwnerId = process.env.METRICS_CHAT_ID
    process.env.METRICS_CHAT_ID = '10'
    try {
      const harness = await createHarness()
      harness.playersRepository.findAll.mockResolvedValue([
        { username: '@owner', userId: 10 }, // verified: false/missing in storage
        { username: '@bob', userId: 11 },
      ])

      const response = await harness.app.inject({ method: 'GET', url: '/api/players' })

      expect(response.json()).toEqual({
        players: [
          { username: '@owner', banned: false, verified: true, isAdmin: false },
          { username: '@bob', banned: false, verified: false, isAdmin: false },
        ],
      })
      await harness.app.close()
    } finally {
      if (previousOwnerId === undefined) delete process.env.METRICS_CHAT_ID
      else process.env.METRICS_CHAT_ID = previousOwnerId
    }
  })

  test('sends a Telegram DM to the banned player and another one when unbanning', async () => {
    const harness = await createHarness({ production: true })
    harness.bot.getChatMember.mockResolvedValue({ status: 'administrator' })
    harness.playersRepository.findOne.mockImplementation(async (username) =>
      username === '@alice' ? { username, userId: 42, banned: false } : null
    )
    harness.playersRepository.setBanned.mockResolvedValue(true)

    const banResponse = await harness.app.inject({
      method: 'DELETE',
      url: '/api/players/alice',
      headers: authHeader('admin', 10),
    })

    expect(banResponse.statusCode).toBe(200)
    expect(harness.bot.sendMessage).toHaveBeenCalledTimes(1)
    expect(harness.bot.sendMessage).toHaveBeenCalledWith(42, 'you are banned')
    // Помимо DM боту, игрока с открытым мини-аппом нужно оповестить сразу
    // же через SSE, а не только через следующий 403 player_banned.
    expect(harness.sseManager.notifyUser).toHaveBeenCalledWith(42, 'player_banned', { reason: 'player_banned' })

    harness.bot.sendMessage.mockClear()
    harness.sseManager.notifyUser.mockClear()
    harness.playersRepository.findOne.mockImplementation(async (username) =>
      username === '@alice' ? { username, userId: 42, banned: true } : null
    )

    const unbanResponse = await harness.app.inject({
      method: 'PATCH',
      url: '/api/players/alice',
      headers: authHeader('admin', 10),
      payload: { banned: false },
    })

    expect(unbanResponse.statusCode).toBe(200)
    expect(harness.bot.sendMessage).toHaveBeenCalledTimes(1)
    expect(harness.bot.sendMessage).toHaveBeenCalledWith(42, 'you are unbanned')
    // Разбан не должен закрывать мини-апп — SSE-пуш шлётся только на бан.
    expect(harness.sseManager.notifyUser).not.toHaveBeenCalled()
    await harness.app.close()
  })

  test('does not send a duplicate DM or SSE push when banning an already banned player', async () => {
    const harness = await createHarness({ production: true })
    harness.bot.getChatMember.mockResolvedValue({ status: 'administrator' })
    harness.playersRepository.findOne.mockImplementation(async (username) =>
      username === '@alice' ? { username, userId: 42, banned: true } : null
    )
    harness.playersRepository.setBanned.mockResolvedValue(true)

    const response = await harness.app.inject({
      method: 'PATCH',
      url: '/api/players/alice',
      headers: authHeader('admin', 10),
      payload: { banned: true },
    })

    expect(response.statusCode).toBe(200)
    expect(harness.bot.sendMessage).not.toHaveBeenCalled()
    expect(harness.sseManager.notifyUser).not.toHaveBeenCalled()
    await harness.app.close()
  })

  test('GET /api/events associates the connection with the userId from initData', async () => {
    const harness = await createHarness({ production: true })

    await readSseChunks(
      harness.app,
      `/api/events?initData=${encodeURIComponent(initDataFor({ id: 77, username: 'alice', first_name: 'Alice' }))}`
    )

    expect(harness.sseManager.addClient).toHaveBeenCalledWith(expect.anything(), 77)
    await harness.app.close()
  })

  test('GET /api/events also resolves the username, so a banned check can fall back to findOne', async () => {
    // No isBanned/findByUserId on this repository — isUserBanned must fall
    // back to findOne(username), which needs the @username resolved from
    // initData, not just the numeric id. Real SseManager here (not the
    // jest.fn() stub) because this asserts on bytes actually written to the
    // socket, which the mocked notifyUser wouldn't produce.
    const playersRepository = {
      findOne: jest.fn().mockResolvedValue({ username: '@alice', banned: true }),
    }
    const harness = await createHarness({ production: true, playersRepository, sseManager: new SseManager() })

    const chunk = await readSseChunks(
      harness.app,
      `/api/events?initData=${encodeURIComponent(initDataFor({ id: 77, username: 'alice', first_name: 'Alice' }))}`
    )

    expect(playersRepository.findOne).toHaveBeenCalledWith('@alice')
    expect(chunk).toContain('event: player_banned')
    await harness.app.close()
  })

  test('GET /api/events pushes player_banned immediately for a player reconnecting while banned', async () => {
    // Real SseManager: needs an actual write to the socket, which the
    // jest.fn() notifyUser stub used elsewhere in this file wouldn't produce.
    const harness = await createHarness({ production: true, sseManager: new SseManager() })
    harness.playersRepository.isBanned.mockResolvedValue(true)

    const chunk = await readSseChunks(
      harness.app,
      `/api/events?initData=${encodeURIComponent(initDataFor({ id: 77, username: 'alice', first_name: 'Alice' }))}`
    )

    expect(harness.playersRepository.isBanned).toHaveBeenCalledWith(77)
    expect(chunk).toContain('event: player_banned')
    await harness.app.close()
  })

  test('GET /api/events does not push player_banned for a player who is not banned', async () => {
    const harness = await createHarness({ production: true, sseManager: new SseManager() })
    harness.playersRepository.isBanned.mockResolvedValue(false)

    const chunk = await readSseChunks(
      harness.app,
      `/api/events?initData=${encodeURIComponent(initDataFor({ id: 77, username: 'alice', first_name: 'Alice' }))}`
    )

    // Не просто "player_banned отсутствует" (что тривиально проходит и при
    // пустом ответе, если grace-окно истекло раньше первой записи) — а
    // "state_update пришёл, а player_banned среди дождавшихся событий нет".
    expect(chunk).toContain('event: state_update')
    expect(chunk).not.toContain('event: player_banned')
    await harness.app.close()
  })

  test('GET /api/events pushes player_verified immediately for a player reconnecting after confirming elsewhere', async () => {
    // Основной сценарий фичи: игрок уходит из мини-аппа в чат подтвердиться,
    // возвращается — SSE-соединение успело порваться и переоткрыться, Redis
    // pub/sub ничего не буферизовал, поэтому push мог не долететь. Эта
    // проверка при (пере)подключении — единственная страховка от вечной
    // блокировки логин-экраном в таком случае.
    const harness = await createHarness({ production: true, sseManager: new SseManager() })
    harness.playersRepository.isVerified.mockResolvedValue(true)

    const chunk = await readSseChunks(
      harness.app,
      `/api/events?initData=${encodeURIComponent(initDataFor({ id: 77, username: 'alice', first_name: 'Alice' }))}`
    )

    expect(harness.playersRepository.isVerified).toHaveBeenCalledWith(77)
    expect(chunk).toContain('event: player_verified')
    await harness.app.close()
  })

  test('GET /api/events does not push player_verified for a player who has not confirmed yet', async () => {
    const harness = await createHarness({ production: true, sseManager: new SseManager() })
    harness.playersRepository.isVerified.mockResolvedValue(false)

    const chunk = await readSseChunks(
      harness.app,
      `/api/events?initData=${encodeURIComponent(initDataFor({ id: 77, username: 'alice', first_name: 'Alice' }))}`
    )

    expect(chunk).toContain('event: state_update')
    expect(chunk).not.toContain('event: player_verified')
    await harness.app.close()
  })

  test('GET /api/events ignores stale initData just like the REST auth() path', async () => {
    const harness = await createHarness({ production: true })
    harness.playersRepository.isBanned.mockResolvedValue(true)
    const stale = initDataFor(
      { id: 77, username: 'alice', first_name: 'Alice' },
      { authDate: Math.floor(Date.now() / 1000) - 25 * 60 * 60 }
    )

    const chunk = await readSseChunks(harness.app, `/api/events?initData=${encodeURIComponent(stale)}`)

    expect(harness.sseManager.addClient).toHaveBeenCalledWith(expect.anything(), null)
    expect(harness.log.warn).toHaveBeenCalledWith(
      'Не удалось проверить initData при подключении к SSE',
      expect.objectContaining({ reason: 'stale_init_data' })
    )
    expect(harness.playersRepository.isBanned).not.toHaveBeenCalled()
    expect(chunk).not.toContain('event: player_banned')
    await harness.app.close()
  })

  test('GET /api/events ignores a forged/invalid initData instead of trusting the connection', async () => {
    const harness = await createHarness({ production: true })
    harness.playersRepository.isBanned.mockResolvedValue(true)

    const chunk = await readSseChunks(harness.app, '/api/events?initData=not-a-valid-signature')

    expect(harness.sseManager.addClient).toHaveBeenCalledWith(expect.anything(), null)
    expect(harness.log.warn).toHaveBeenCalledWith(
      'Не удалось проверить initData при подключении к SSE',
      expect.objectContaining({ reason: expect.any(String) })
    )
    expect(harness.playersRepository.isBanned).not.toHaveBeenCalled()
    expect(chunk).not.toContain('event: player_banned')
    await harness.app.close()
  })

  test('GET /api/events without initData in production stays anonymous', async () => {
    const harness = await createHarness({ production: true })

    await readSseChunks(harness.app, '/api/events')

    expect(harness.sseManager.addClient).toHaveBeenCalledWith(expect.anything(), null)
    await harness.app.close()
  })

  test('GET /api/events falls back to the shared dev user id when initData is absent outside production', async () => {
    const harness = await createHarness({ production: false })

    await readSseChunks(harness.app, '/api/events')

    // Must match the DEV_USER_ID used by auth()'s dev fallback (router.js) —
    // a mismatch would silently split dev-mode ban checks across two ids.
    expect(harness.sseManager.addClient).toHaveBeenCalledWith(expect.anything(), 123456)
    await harness.app.close()
  })

  test('does not send a DM when "unbanning" a player who was not banned', async () => {
    const harness = await createHarness({ production: true })
    harness.bot.getChatMember.mockResolvedValue({ status: 'administrator' })
    harness.playersRepository.findOne.mockImplementation(async (username) =>
      username === '@alice' ? { username, userId: 42, banned: false } : null
    )
    harness.playersRepository.setBanned.mockResolvedValue(true)

    const response = await harness.app.inject({
      method: 'PATCH',
      url: '/api/players/alice',
      headers: authHeader('admin', 10),
      payload: { banned: false },
    })

    expect(response.statusCode).toBe(200)
    expect(harness.bot.sendMessage).not.toHaveBeenCalled()
    await harness.app.close()
  })

  test('PATCH ban sends a DM even against a repository that mutates records in place', async () => {
    // InMemoryPlayersRepository.findOne returns a live reference that
    // setBanned mutates in place — reading `player.banned` after
    // setPlayerBanned would always see the new value. A jest.fn() mock
    // can't reproduce that aliasing, so this regression needs the real
    // repository (this is also the fallback used in production whenever
    // PLAYERS_MONGODB_URI is not set).
    const playersRepository = new InMemoryPlayersRepository()
    await playersRepository.upsert({ username: '@alice', userId: 42, firstName: 'Alice' })
    // The acting admin also needs to be verified — requireVerified gates
    // ban management too. auth() upserts @admin on the request itself, but
    // that happens inside inject(), too late to pre-verify here — so claim
    // it up front the same way auth() would.
    await playersRepository.upsert({ username: '@admin', userId: 10 })
    await playersRepository.setVerified('@admin', true)
    const harness = await createHarness({ production: true, playersRepository })
    harness.bot.getChatMember.mockResolvedValue({ status: 'administrator' })

    const response = await harness.app.inject({
      method: 'PATCH',
      url: '/api/players/alice',
      headers: authHeader('admin', 10),
      payload: { banned: true },
    })

    expect(response.statusCode).toBe(200)
    expect(harness.bot.sendMessage).toHaveBeenCalledTimes(1)
    expect(harness.bot.sendMessage).toHaveBeenCalledWith(42, 'you are banned')
    await harness.app.close()
  })

  test('PATCH unban sends a DM even against a repository that mutates records in place', async () => {
    // Mirrors the ban regression test above: InMemoryPlayersRepository
    // mutates the record setBanned reads from, so this aliasing trap needs
    // the real repository — a jest.fn() mock can't reproduce it.
    const playersRepository = new InMemoryPlayersRepository()
    await playersRepository.upsert({ username: '@alice', userId: 42, firstName: 'Alice' })
    await playersRepository.setBanned('@alice', true)
    await playersRepository.upsert({ username: '@admin', userId: 10 })
    await playersRepository.setVerified('@admin', true)
    const harness = await createHarness({ production: true, playersRepository })
    harness.bot.getChatMember.mockResolvedValue({ status: 'administrator' })

    const response = await harness.app.inject({
      method: 'PATCH',
      url: '/api/players/alice',
      headers: authHeader('admin', 10),
      payload: { banned: false },
    })

    expect(response.statusCode).toBe(200)
    expect(harness.bot.sendMessage).toHaveBeenCalledTimes(1)
    expect(harness.bot.sendMessage).toHaveBeenCalledWith(42, 'you are unbanned')
    await harness.app.close()
  })

  test('does not send a DM when unbanning a previously-banned player without a userId', async () => {
    // A player can be marked banned without ever having authorized through
    // the mini app, so player.userId is null even though wasAlreadyBanned
    // is true — this exercises the new unban branch itself (not just the
    // findOne-returns-null short circuit) and its notifyPlayerDirect guard.
    const harness = await createHarness({ production: true })
    harness.bot.getChatMember.mockResolvedValue({ status: 'administrator' })
    harness.playersRepository.findOne.mockImplementation(async (username) =>
      username === '@alice' ? { username, userId: null, banned: true } : null
    )
    harness.playersRepository.setBanned.mockResolvedValue(true)

    const response = await harness.app.inject({
      method: 'PATCH',
      url: '/api/players/alice',
      headers: authHeader('admin', 10),
      payload: { banned: false },
    })

    expect(response.statusCode).toBe(200)
    expect(harness.bot.sendMessage).not.toHaveBeenCalled()
    await harness.app.close()
  })

  test('caches the chat administrators list across GET /api/players calls', async () => {
    const harness = await createHarness()
    harness.bot.getChatAdministrators.mockResolvedValue([{ user: { id: 10 } }])
    harness.playersRepository.findAll.mockResolvedValue([{ username: '@alice', userId: 10 }])

    await harness.app.inject({ method: 'GET', url: '/api/players' })
    await harness.app.inject({ method: 'GET', url: '/api/players' })

    expect(harness.bot.getChatAdministrators).toHaveBeenCalledTimes(1)
    await harness.app.close()
  })

  test('fails open and allows the ban when the chat administrators lookup is unavailable', async () => {
    const harness = await createHarness({ production: true })
    harness.bot.getChatMember.mockResolvedValue({ status: 'administrator' })
    harness.bot.getChatAdministrators.mockRejectedValue(new Error('Telegram API unavailable'))
    harness.playersRepository.findOne.mockImplementation(async (username) =>
      username === '@alice' ? { username, userId: 42, banned: false } : null
    )
    harness.playersRepository.setBanned.mockResolvedValue(true)

    const response = await harness.app.inject({
      method: 'DELETE',
      url: '/api/players/alice',
      headers: authHeader('admin', 10),
    })

    // Осознанный fail-open: недоступность Telegram не должна блокировать
    // легитимные действия админа, даже когда цель на самом деле тоже админ.
    expect(response.statusCode).toBe(200)
    await harness.app.close()
  })

  test('ban path re-checks admin status instead of reading the cached GET /api/players list', async () => {
    const harness = await createHarness({ production: true })
    harness.bot.getChatMember.mockResolvedValue({ status: 'administrator' })
    harness.playersRepository.findOne.mockImplementation(async (username) =>
      username === '@alice' ? { username, userId: 42, banned: false } : null
    )
    // Прогреваем кеш заведомо устаревшим "не админ" ответом.
    harness.bot.getChatAdministrators.mockResolvedValueOnce([])
    await harness.app.inject({ method: 'GET', url: '/api/players' })

    // К моменту бана @alice уже назначена админом чата, но кеш из GET ещё
    // не истёк (TTL 30с). Без fresh: true в ban-хендлере тест ловил бы 200
    // вместо 403.
    harness.bot.getChatAdministrators.mockResolvedValue([{ user: { id: 42 } }])
    const response = await harness.app.inject({
      method: 'DELETE',
      url: '/api/players/alice',
      headers: authHeader('admin', 10),
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'cannot_ban_admin' })
    await harness.app.close()
  })

  test('rejects a match with a banned opponent before executing the use case', async () => {
    const harness = await createHarness({ production: true })
    harness.playersRepository.findOne.mockImplementation(async (username) =>
      username === '@banned' ? { username, banned: true } : null
    )

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/match',
      headers: authHeader('alice', 10),
      payload: { opponent: '@banned' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'player_banned' })
    expect(harness.context.addMatch.execute).not.toHaveBeenCalled()
    await harness.app.close()
  })

  test('passes current participant identities to atomic match acceptance', async () => {
    const harness = await createHarness({ production: true })
    harness.playersRepository.findOne.mockImplementation(async (username) =>
      username === '@old' ? { username, userId: 99, banned: false } : null
    )
    harness.state.searching.push('@old')
    harness.state.searchingIdentities = { '@old': { username: '@old', userId: 99, generation: 1 } }
    harness.state.ownership['@old'] = { userId: 99, generation: 1, status: 'active' }

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/match',
      headers: authHeader('alice', 7),
      payload: { opponent: '@old' },
    })

    expect(response.statusCode).toBe(200)
    expect(harness.context.addMatch.execute).toHaveBeenCalledWith('@old', '@alice', {
      scheduleLifecycle: true,
      participantIdentities: {
        '@old': { username: '@old', userId: 99, generation: 1 },
        '@alice': expect.objectContaining({ username: '@alice', userId: 7, generation: 2 }),
      },
    })
    await harness.app.close()
  })

  test('rejects an invite from a banned initiator before creating a match', async () => {
    const harness = await createHarness({ production: true })
    const invite = await harness.invitesStore.create({ player: '@banned', opponent: '@bob' })
    harness.playersRepository.findOne.mockImplementation(async (username) =>
      username === '@banned' ? { username, banned: true } : null
    )

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/direct/accept',
      headers: authHeader('bob', 2),
      payload: { inviteId: invite.inviteId },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'player_banned' })
    expect(harness.context.addMatch.execute).not.toHaveBeenCalled()
    await harness.app.close()
  })

  test('removes a banned player from search and pending invites but keeps existing matches', async () => {
    const harness = await createHarness({ production: true })
    harness.bot.getChatMember.mockResolvedValue({ status: 'administrator' })
    harness.state.searching.push('@alice')
    harness.state.searchingIdentities = { '@alice': { username: '@alice', userId: 1, generation: 1 } }
    harness.state.ownership['@alice'] = { userId: 1, generation: 1, status: 'active' }
    harness.playersRepository.findOne.mockImplementation(async (username) =>
      username === '@alice' ? { username, userId: 1 } : null
    )
    await harness.invitesStore.create({ player: '@alice', opponent: '@bob' })

    const response = await harness.app.inject({
      method: 'DELETE',
      url: '/api/players/alice',
      headers: authHeader('admin', 10),
    })

    expect(response.statusCode).toBe(200)
    expect(harness.state.searching).toEqual([])
    expect(await harness.invitesStore.getAll()).toEqual([])
    expect(harness.state.queue).toEqual([])
    await harness.app.close()
  })

  test('cleans stale aliases and blocks old invites after a username rename and ban', async () => {
    const harness = await createHarness({ production: true })
    harness.bot.getChatMember.mockResolvedValue({ status: 'administrator' })
    harness.playersRepository.getAliases.mockResolvedValue(['@new', '@old'])
    harness.playersRepository.setBanned.mockResolvedValue(true)
    harness.state.searching.push('@old')
    harness.state.searchingIdentities = { '@old': { username: '@old', userId: 42, generation: 1 } }
    harness.state.ownership['@old'] = { userId: 42, generation: 1, status: 'active' }
    harness.playersRepository.findOne.mockImplementation(async (username) =>
      username === '@new' ? { username, userId: 42 } : null
    )
    await harness.invitesStore.create({ player: '@old', opponent: '@bob' })

    const banResponse = await harness.app.inject({
      method: 'DELETE',
      url: '/api/players/new',
      headers: authHeader('admin', 10),
    })

    expect(banResponse.statusCode).toBe(200)
    expect(harness.state.searching).toEqual([])
    expect(await harness.invitesStore.getAll()).toEqual([])

    harness.playersRepository.findOne.mockImplementation(async (username) =>
      ['@new', '@old'].includes(username) ? { username: '@new', banned: true } : null
    )
    harness.playersRepository.isBanned.mockImplementation(async (userId) => userId === 42)
    const staleInvite = await harness.invitesStore.create({ player: '@old', opponent: '@bob' })

    const acceptResponse = await harness.app.inject({
      method: 'POST',
      url: '/api/direct/accept',
      headers: authHeader('bob', 2),
      payload: { inviteId: staleInvite.inviteId },
    })
    const createResponse = await harness.app.inject({
      method: 'POST',
      url: '/api/search',
      headers: authHeader('new', 42),
    })

    expect(acceptResponse.statusCode).toBe(403)
    expect(createResponse.statusCode).toBe(403)
    expect(harness.context.addMatch.execute).not.toHaveBeenCalled()
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
    harness.state.ownership['@bob'] = { userId: 2, generation: 1, status: 'active' }
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
    expect(harness.context.addMatch.execute).toHaveBeenCalledWith('@alice', '@bob', expect.objectContaining({
      scheduleLifecycle: true,
      participantIdentities: expect.objectContaining({
        '@bob': expect.objectContaining({ username: '@bob', userId: 2, generation: 1 }),
      }),
      inviteIdentities: expect.any(Object),
    }))
    expect(await harness.invitesStore.getAll()).toEqual([])
    expect(harness.bot.sendMessage).toHaveBeenCalledTimes(1)
    await harness.app.close()
  })

  test('rejects a new invite when the opponent already has a pending invite of their own', async () => {
    const harness = await createHarness({ production: true })
    harness.state.ownership['@bob'] = { userId: 2, generation: 1, status: 'active' }
    harness.state.ownership['@dave'] = { userId: 4, generation: 1, status: 'active' }
    harness.playersRepository.findOne.mockImplementation(async (username) =>
      ['@bob', '@dave'].includes(username) ? { username, userId: username === '@bob' ? 2 : 4, generation: 1 } : null
    )

    // bob уже пригласил dave — у bob есть своё исходящее приглашение.
    const bobInvite = await harness.app.inject({
      method: 'POST',
      url: '/api/direct',
      headers: authHeader('bob', 2),
      payload: { opponent: '@dave' },
    })
    expect(bobInvite.json()).toEqual({ ok: true })
    harness.context.directMatch.execute.mockClear()

    // alice пытается позвать bob напрямую — если разрешить, приглашение bob→dave осиротеет
    // (тот же сценарий, что и с общим поиском в SearchPanel/PlayersView).
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/direct',
      headers: authHeader('alice', 10),
      payload: { opponent: '@bob' },
    })

    expect(response.json()).toEqual({ ok: false, reason: 'opponent_invite_pending' })
    expect(harness.context.directMatch.execute).not.toHaveBeenCalled()
    expect(await harness.invitesStore.getAll()).toHaveLength(1)
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
    expect(harness.bot.sendMessage).toHaveBeenCalledTimes(2)
    await harness.app.close()
  })

  test('sends REST direct invite to the recipient private chat', async () => {
    const harness = await createHarness({ production: true })
    harness.playersRepository.findOne.mockImplementation(async (username) =>
      username === '@bob' ? { username, userId: 22, generation: 1, banned: false } : null
    )

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/direct',
      headers: authHeader('alice', 10),
      payload: { opponent: '@bob' },
    })

    expect(response.json()).toEqual({ ok: true })
    // Прямое приглашение не анонсируется в общий чат: обе стороны получают сообщения в ЛС.
    expect(harness.bot.sendMessage).toHaveBeenCalledTimes(2)
    expect(harness.bot.sendMessage.mock.calls[0][0]).toBe(2)
    expect(harness.bot.sendMessage.mock.calls[0][2].reply_markup.inline_keyboard).toHaveLength(1)
    expect(harness.bot.sendMessage.mock.calls[1][0]).toBe(10)
    expect(harness.bot.sendMessage.mock.calls[1][2].reply_markup.inline_keyboard[0][0].callback_data)
      .toMatch(/^direct_cancel:/)
    await harness.app.close()
  })

  test('falls back to the queue chat when REST private delivery fails', async () => {
    const harness = await createHarness({ production: true })
    // Реальный получатель резолвится из ownership состояния (userId: 2), а не из playersRepository.
    harness.bot.sendMessage.mockImplementation((chatId) =>
      chatId === 2 ? Promise.reject(new Error('private chat unavailable')) : Promise.resolve()
    )

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/direct',
      headers: authHeader('alice', 10),
      payload: { opponent: '@bob' },
    })

    expect(response.json()).toEqual({ ok: true })
    // Получатель недоступен в ЛС → полное приглашение уходит в общий чат как единственный способ его увидеть.
    // Подтверждение инициатору при этом не отправляется вовсе (sentDirect: false).
    expect(harness.bot.sendMessage).toHaveBeenCalledTimes(2)
    expect(harness.bot.sendMessage.mock.calls[0][0]).toBe(2)
    expect(harness.bot.sendMessage.mock.calls[1][0]).toBe('queue-chat')
    expect(harness.bot.sendMessage.mock.calls[0][2].reply_markup.inline_keyboard).toHaveLength(1)
    expect(harness.bot.sendMessage.mock.calls[1][2].reply_markup.inline_keyboard).toHaveLength(2)
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
    const invite = await harness.invitesStore.create({ player: '@alice', opponent: '@bob' })
    harness.invitesStore.consume = jest.fn().mockRejectedValue(new Error('redis unavailable'))

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/direct/accept',
      headers: authHeader('bob', 2),
      payload: { inviteId: invite.inviteId },
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'invite_storage_unavailable' })
    expect(harness.context.addMatch.execute).not.toHaveBeenCalled()
    await harness.app.close()
  })

  test('cancelling a search from the mini app deletes the announcement it created', async () => {
    const harness = await createHarness({ production: true })
    harness.bot.sendMessage.mockResolvedValue({ message_id: 555, chat: { id: 'queue-chat' } })

    await harness.app.inject({
      method: 'POST',
      url: '/api/search',
      headers: authHeader('alice', 10),
    })

    const response = await harness.app.inject({
      method: 'DELETE',
      url: '/api/search',
      headers: authHeader('alice', 10),
    })

    expect(response.json()).toEqual({ ok: true, status: 'removed' })
    expect(harness.bot.deleteMessage).toHaveBeenCalledWith('queue-chat', 555)
    // Никакого нового "передумал" сообщения поверх удалённого анонса.
    expect(harness.bot.sendMessage).toHaveBeenCalledTimes(1)
    await harness.app.close()
  })

  test('cancelling a search created outside the mini app stays silent too (no "changed mind" text)', async () => {
    const harness = await createHarness({ production: true })

    const response = await harness.app.inject({
      method: 'DELETE',
      url: '/api/search',
      headers: authHeader('alice', 10),
    })

    expect(response.json()).toEqual({ ok: true, status: 'removed' })
    expect(harness.bot.deleteMessage).not.toHaveBeenCalled()
    // DELETE /api/search приходит только из мини-аппа — независимо от того,
    // где был создан анонс, текст "Игрок передумал" в общий чат не летит.
    expect(harness.bot.sendMessage).not.toHaveBeenCalled()
    await harness.app.close()
  })

  test('accepting a search from the mini app replaces its announcement with the match instead of leaving it stale', async () => {
    const harness = await createHarness({ production: true })
    harness.bot.sendMessage.mockResolvedValue({ message_id: 777, chat: { id: 'queue-chat' } })
    const match = { player1: '@alice', player2: '@bob' }
    harness.context.addMatch.execute.mockResolvedValue({ ok: true, match })

    await harness.app.inject({
      method: 'POST',
      url: '/api/search',
      headers: authHeader('alice', 10),
    })

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/match',
      headers: authHeader('bob', 2),
      payload: { opponent: '@alice' },
    })

    expect(response.json()).toEqual({ ok: true })
    expect(harness.bot.editMessageText).toHaveBeenCalledWith(
      'search accepted',
      expect.objectContaining({ chat_id: 'queue-chat', message_id: 777 })
    )
    expect(harness.bot.deleteMessage).not.toHaveBeenCalled()
    await harness.app.close()
  })

  test('stays silent and just strips the keyboard when Telegram refuses to delete the mini-app announcement', async () => {
    const harness = await createHarness({ production: true })
    harness.bot.sendMessage.mockResolvedValue({ message_id: 555, chat: { id: 'queue-chat' } })

    await harness.app.inject({
      method: 'POST',
      url: '/api/search',
      headers: authHeader('alice', 10),
    })

    harness.bot.deleteMessage.mockRejectedValue(new Error('message can\'t be deleted'))

    const response = await harness.app.inject({
      method: 'DELETE',
      url: '/api/search',
      headers: authHeader('alice', 10),
    })

    expect(response.json()).toEqual({ ok: true, status: 'removed' })
    expect(harness.bot.deleteMessage).toHaveBeenCalledTimes(1)
    // Отмена из мини-аппа никогда не должна показывать "Игрок передумал" в
    // чате — даже когда удалить исходный анонс не вышло, мы лишь снимаем
    // клавиатуру, а не подменяем/шлём текст.
    expect(harness.bot.editMessageReplyMarkup).toHaveBeenCalledWith(
      { inline_keyboard: [] },
      { chat_id: 'queue-chat', message_id: 555 }
    )
    expect(harness.bot.editMessageText).not.toHaveBeenCalled()
    expect(harness.bot.sendMessage).toHaveBeenCalledTimes(1)
    await harness.app.close()
  })

  test('skips the redundant keyboard-strip call once Telegram confirms the announcement is already gone', async () => {
    const harness = await createHarness({ production: true })
    harness.bot.sendMessage.mockResolvedValue({ message_id: 555, chat: { id: 'queue-chat' } })

    await harness.app.inject({
      method: 'POST',
      url: '/api/search',
      headers: authHeader('alice', 10),
    })

    harness.bot.deleteMessage.mockRejectedValue(new Error('message to delete not found'))

    const response = await harness.app.inject({
      method: 'DELETE',
      url: '/api/search',
      headers: authHeader('alice', 10),
    })

    expect(response.json()).toEqual({ ok: true, status: 'removed' })
    expect(harness.bot.deleteMessage).toHaveBeenCalledTimes(1)
    // Сообщение точно не существует — второй вызов (editMessageReplyMarkup)
    // заведомо провалится тем же образом, поэтому его не делаем.
    expect(harness.bot.editMessageReplyMarkup).not.toHaveBeenCalled()
    expect(harness.bot.sendMessage).toHaveBeenCalledTimes(1)
    await harness.app.close()
  })

  test('accepting a direct invite clears a concurrent general-search announcement for the initiator', async () => {
    const harness = await createHarness({ production: true })
    harness.bot.sendMessage.mockResolvedValue({ message_id: 555, chat: { id: 'queue-chat' } })

    // alice тем временем независимо ищет соперника через мини-апп — это и есть
    // анонс, который должен быть закрыт при принятии её прямого приглашения.
    await harness.app.inject({
      method: 'POST',
      url: '/api/search',
      headers: authHeader('alice', 10),
    })

    const invite = await harness.invitesStore.create({
      player: '@alice',
      opponent: '@bob',
      createdAt: Date.now(),
    })
    const match = { player1: '@alice', player2: '@bob' }
    harness.context.addMatch.execute.mockResolvedValue({ ok: true, match })

    await harness.app.inject({
      method: 'POST',
      url: '/api/direct/accept',
      headers: authHeader('bob', 2),
      payload: { inviteId: invite.inviteId },
    })

    expect(harness.bot.editMessageText).toHaveBeenCalledWith(
      'search accepted',
      expect.objectContaining({ chat_id: 'queue-chat', message_id: 555 })
    )

    // Позже alice отменяет поиск заново — это уже не должно трогать анонс,
    // закрытый принятием прямого приглашения (иначе снесли бы чужое сообщение).
    harness.bot.deleteMessage.mockClear()
    await harness.app.inject({
      method: 'DELETE',
      url: '/api/search',
      headers: authHeader('alice', 10),
    })

    expect(harness.bot.deleteMessage).not.toHaveBeenCalled()
    await harness.app.close()
  })

  test('accepting a direct invite silently clears the announcement of a third player orphaned by AddMatch', async () => {
    const harness = await createHarness({ production: true })
    harness.bot.sendMessage.mockResolvedValue({ message_id: 999, chat: { id: 'queue-chat' } })

    // charlie тем временем независимо ищет соперника через мини-апп — это тот
    // самый анонс, который AddMatch не видит и не может закрыть сам: он лишь
    // сообщает роутеру, кого выкинуло из поиска как побочный эффект чужого
    // матча (см. AddMatch.discardStaleInvites), закрывать анонс — забота роутера.
    await harness.app.inject({
      method: 'POST',
      url: '/api/search',
      headers: authHeader('charlie', 30),
    })

    const invite = await harness.invitesStore.create({
      player: '@alice',
      opponent: '@bob',
      createdAt: Date.now(),
    })
    const match = { player1: '@alice', player2: '@bob' }
    harness.context.addMatch.execute.mockResolvedValue({ ok: true, match, orphanedSearchers: ['@charlie'] })

    await harness.app.inject({
      method: 'POST',
      url: '/api/direct/accept',
      headers: authHeader('bob', 2),
      payload: { inviteId: invite.inviteId },
    })

    // Анонс charlie тихо удаляется — без нового текстового сообщения в чат
    // ("Игрок передумал" ему тут совсем ни при чём). notifyChat всегда зовёт
    // sendMessage с ровно тремя аргументами (третий — undefined без
    // reply_markup), поэтому matcher должен бить по этой же форме — иначе
    // expect.anything() молча пропускает undefined и проверка ничего не ловит.
    expect(harness.bot.deleteMessage).toHaveBeenCalledWith('queue-chat', 999)
    expect(harness.bot.sendMessage).not.toHaveBeenCalledWith('queue-chat', 'search cancelled', undefined)
    await harness.app.close()
  })

  test('cancelling a direct invite clears a concurrent general-search announcement for the initiator', async () => {
    const harness = await createHarness({ production: true })
    harness.bot.sendMessage.mockResolvedValue({ message_id: 555, chat: { id: 'queue-chat' } })

    // alice независимо ищет соперника через мини-апп — анонс должен быть тихо
    // закрыт при отмене её прямого приглашения, а не остаться висеть в чате.
    await harness.app.inject({
      method: 'POST',
      url: '/api/search',
      headers: authHeader('alice', 10),
    })

    const invite = await harness.invitesStore.create({
      player: '@alice',
      opponent: '@bob',
      playerIdentity: { username: '@alice', userId: 10, generation: 1 },
      opponentIdentity: { username: '@bob', userId: 2, generation: 1 },
      createdAt: Date.now(),
    })
    harness.bot.sendMessage.mockClear()
    harness.bot.deleteMessage.mockClear()

    const cancelResponse = await harness.app.inject({
      method: 'POST',
      url: '/api/direct/cancel',
      headers: authHeader('alice', 10),
      payload: { inviteId: invite.inviteId },
    })

    expect(cancelResponse.json()).toEqual({ ok: true })
    // Анонс "хочет поиграть" тихо удаляется вместе с приглашением, без нового
    // текстового сообщения в общий чат — уведомление об отмене уходит только
    // целевому игроку в ЛС.
    expect(harness.bot.deleteMessage).toHaveBeenCalledWith('queue-chat', 555)
    expect(harness.bot.sendMessage).toHaveBeenCalledTimes(1)
    expect(harness.bot.sendMessage).toHaveBeenCalledWith(2, 'cancelled')
    await harness.app.close()
  })
})
