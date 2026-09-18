import { jest } from '@jest/globals'
import { InMemoryQueueRepository } from '#infrastructure/repositories/InMemoryQueueRepository.js'
import { InMemoryPlayersRepository } from '#infrastructure/players/InMemoryPlayersRepository.js'
import { InMemoryInvitesStore } from '#infrastructure/invites/InMemoryInvitesStore.js'
import { Match } from '#domain/entities/Match.js'
import { QueueState } from '#domain/entities/QueueState.js'

const instances = []

const queueWithActiveIdentity = (username, userId, generation = 1) =>
  new InMemoryQueueRepository(new QueueState({
    ownership: { [username]: { userId, generation, status: 'active' } },
  }))

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
      queueRepository: queueWithActiveIdentity('@bob', 42, 2),
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
    const p1Identity = { username: '@p1', userId: 1, generation: 1 }
    const p2Identity = { username: '@p2', userId: 2, generation: 1 }
    const inner = new InMemoryQueueRepository(new QueueState({
      searching: ['@p1'],
      searchingIdentities: { '@p1': p1Identity },
      ownership: {
        '@p1': { ...p1Identity, status: 'active' },
        '@p2': { ...p2Identity, status: 'active' },
      },
    }))
    let injected = false
    let botResult
    const repository = {
      getVersioned: (...args) => inner.getVersioned(...args),
      save: (...args) => inner.save(...args),
      saveIfRevision: async (expectedRevision, state) => {
        if (injected) return inner.saveIfRevision(expectedRevision, state)
        injected = true
        // Конкурентный direct-accept: принимающий создаёт матч, пока /pause сохраняет свой снапшот
        const acceptResult = await botResult.getContext('queue').addMatch.execute('@p1', '@p2', {
          participantIdentities: { '@p1': p1Identity, '@p2': p2Identity },
        })
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

  test('blocks banned commands before the use case but explains the ban on /start', async () => {
    const playersRepository = {
      upsert: jest.fn().mockResolvedValue(undefined),
      isBanned: jest.fn().mockResolvedValue(true),
    }
    const botResult = createBot('token', {
      queueRepository: queueWithActiveIdentity('@bob', 42, 2),
      playersRepository,
      autoStartPolling: false,
    })
    const fakeBot = instances[0]
    const context = botResult.getContext('queue')
    const registerSearch = jest.spyOn(context.registerSearch, 'execute')

    const searchHandler = fakeBot.textHandlers.find(({ pattern }) => pattern.test('/search')).handler
    await searchHandler({
      chat: { id: 'queue' },
      from: { id: 9, username: 'banned' },
      message_id: 7,
    })

    expect(registerSearch).not.toHaveBeenCalled()
    expect(fakeBot.sendMessage).toHaveBeenCalledWith(
      'queue',
      expect.stringContaining('заблокированы'),
      { reply_to_message_id: 7 }
    )

    const startHandler = fakeBot.textHandlers.find(({ pattern }) => pattern.test('/start')).handler
    await startHandler({ chat: { id: 'queue' }, from: { id: 9, username: 'banned' } })
    expect(fakeBot.sendMessage).toHaveBeenLastCalledWith(
      'queue',
      expect.stringContaining('заблокированы'),
      undefined
    )
  })

  test('claims private /start through the durable queue context for legacy identity generations', async () => {
    const playersRepository = {
      claimIdentity: jest.fn(async ({ generation }) => ({ ok: generation === 2 })),
      findOne: jest.fn().mockResolvedValue({
        username: '@legacy',
        userId: 7,
        generation: 2,
        banned: false,
      }),
    }
    const queueRepository = queueWithActiveIdentity('@legacy', 7, 2)
    const botResult = createBot('token', {
      queueRepository,
      playersRepository,
      autoStartPolling: false,
    })
    const fakeBot = instances[0]
    const durableContext = botResult.getContext('queue')
    const startHandler = fakeBot.textHandlers.find(({ pattern }) => pattern.test('/start')).handler

    await startHandler({
      chat: { id: 7001 },
      from: { id: 7, username: 'legacy' },
    })

    expect(playersRepository.claimIdentity).toHaveBeenCalledWith(expect.objectContaining({
      username: '@legacy',
      userId: 7,
      generation: 2,
    }))
    expect(fakeBot.sendMessage).toHaveBeenCalledWith(7001, expect.any(String))
    expect(botResult.getContext('queue')).toBe(durableContext)
    expect(fakeBot.setMyCommands).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scope: { type: 'chat', chat_id: 7001 } })
    )
    await botResult.dispose()
  })

  test('sends direct invite to recipient private messages with the keyboard', async () => {
    const playersRepository = {
      upsert: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn(async (username) =>
        username === '@bob'
          ? { username, userId: 42, generation: 2, banned: false }
          : username === '@alice'
          ? { username, userId: 1, banned: false }
          : null
      ),
    }
    const botResult = createBot('token', {
      queueRepository: queueWithActiveIdentity('@bob', 42, 2),
      playersRepository,
      autoStartPolling: false,
    })
    const fakeBot = instances[0]
    const playHandler = fakeBot.textHandlers.find(({ pattern }) => pattern.test('/play @bob')).handler

    await playHandler({
      chat: { id: 'queue' },
      from: { id: 1, username: 'alice' },
      message_id: 8,
      text: '/play @bob',
    }, ['/play @bob', '@bob'])

    // Прямое приглашение не анонсируется в общий чат: обе стороны получают сообщения в ЛС.
    expect(fakeBot.sendMessage).toHaveBeenCalledTimes(2)
    expect(fakeBot.sendMessage.mock.calls[0][0]).toBe(42)
    expect(fakeBot.sendMessage.mock.calls[0][2].reply_markup.inline_keyboard).toHaveLength(1)
    expect(fakeBot.sendMessage.mock.calls[0][2].reply_markup.inline_keyboard[0]).toHaveLength(2)
    expect(fakeBot.sendMessage.mock.calls[1][0]).toBe(1)
    expect(fakeBot.sendMessage.mock.calls[1][2].reply_markup.inline_keyboard).toHaveLength(1)
    expect(fakeBot.sendMessage.mock.calls[1][2].reply_markup.inline_keyboard[0][0].callback_data)
      .toMatch(/^direct_cancel:/)

    const callbackData = fakeBot.sendMessage.mock.calls[0][2].reply_markup.inline_keyboard[0][0].callback_data
    const callbackHandler = fakeBot.eventHandlers.get('callback_query')
    await callbackHandler({
      id: 'private-direct-accept',
      from: { id: 42, username: 'bob' },
      data: callbackData,
      message: { chat: { id: 42 }, message_id: 100 },
    })

    expect(fakeBot.editMessageText).toHaveBeenCalledWith(
      expect.any(String),
      { chat_id: 42, message_id: 100 }
    )
    await botResult.dispose()
  })

  test('waits for Telegram registration before executing /play', async () => {
    let resolveRegistration
    const registration = new Promise((resolve) => { resolveRegistration = resolve })
    const invitesStore = new InMemoryInvitesStore()
    const playersRepository = {
      upsert: jest.fn().mockReturnValue(registration),
      findOne: jest.fn(async (username) =>
        username === '@bob'
          ? { username, userId: 42, generation: 2, banned: false }
          : username === '@alice'
          ? { username, userId: 1, generation: 2, banned: false }
          : null
      ),
    }
    const botResult = createBot('token', {
      queueRepository: queueWithActiveIdentity('@bob', 42, 2),
      playersRepository,
      invitesStore,
      autoStartPolling: false,
    })
    const fakeBot = instances[0]
    const playHandler = fakeBot.textHandlers.find(({ pattern }) => pattern.test('/play @bob')).handler

    const action = playHandler({
      chat: { id: 'queue' },
      from: { id: 1, username: 'alice' },
      message_id: 11,
      text: '/play @bob',
    }, ['/play @bob', '@bob'])
    await new Promise((resolve) => setImmediate(resolve))

    expect(playersRepository.upsert).toHaveBeenCalled()
    expect(await invitesStore.getAll()).toEqual([])
    expect(fakeBot.sendMessage).not.toHaveBeenCalled()

    resolveRegistration()
    await action

    expect((await invitesStore.getAll())).toHaveLength(1)
    expect(fakeBot.sendMessage).toHaveBeenCalledWith(42, expect.any(String), expect.any(Object))
    await botResult.dispose()
  })

  test('does not create an invite when Telegram registration fails', async () => {
    const invitesStore = new InMemoryInvitesStore()
    const playersRepository = {
      upsert: jest.fn().mockRejectedValue(new Error('registration unavailable')),
      findOne: jest.fn().mockResolvedValue(null),
    }
    const botResult = createBot('token', {
      queueRepository: queueWithActiveIdentity('@old', 42, 1),
      playersRepository,
      invitesStore,
      autoStartPolling: false,
    })
    const fakeBot = instances[0]
    const playHandler = fakeBot.textHandlers.find(({ pattern }) => pattern.test('/play @bob')).handler

    await playHandler({
      chat: { id: 'queue' },
      from: { id: 1, username: 'alice' },
      message_id: 12,
      text: '/play @bob',
    }, ['/play @bob', '@bob'])

    expect(await invitesStore.getAll()).toEqual([])
    expect(fakeBot.sendMessage).toHaveBeenCalledWith(
      'queue',
      expect.stringContaining('проверить доступ'),
      { reply_to_message_id: 12 }
    )
    await botResult.dispose()
  })

  test('permits the triggering Telegram command after a successful rename transition', async () => {
    const playersRepository = {
      upsert: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn().mockResolvedValue({ banned: false }),
    }
    const queueRepository = new InMemoryQueueRepository(new QueueState({
      ownership: {
        '@old': { userId: 1, generation: 1, status: 'active' },
      },
    }))
    const botResult = createBot('token', {
      queueRepository,
      playersRepository,
      autoStartPolling: false,
    })
    const fakeBot = instances[0]
    const context = botResult.getContext('queue')
    const searchExecute = jest.spyOn(context.registerSearch, 'execute')
    const searchHandler = fakeBot.textHandlers.find(({ pattern }) => pattern.test('/search')).handler

    await searchHandler({
      chat: { id: 'queue' },
      from: { id: 1, username: 'new' },
      message_id: 13,
      text: '/search',
    })

    expect(searchExecute).toHaveBeenCalledWith('@new', expect.objectContaining({
      username: '@new',
      userId: 1,
      status: 'active',
    }))
    await expect(queueRepository.get()).resolves.toMatchObject({
      searching: ['@new'],
    })
    expect(fakeBot.sendMessage).toHaveBeenCalledWith('queue', expect.any(String), expect.any(Object))
    await botResult.dispose()
  })

  test('reports failed claim cleanup without rejecting or mutating the queue action', async () => {
    const playersRepository = {
      upsert: jest.fn().mockRejectedValue(new Error('registration unavailable')),
      findOne: jest.fn().mockResolvedValue(null),
    }
    const invitesStore = {
      deleteByParticipant: jest.fn().mockRejectedValue(new Error('invite storage unavailable')),
    }
    const queueRepository = new InMemoryQueueRepository(new QueueState({
      ownership: {
        '@old': { userId: 1, generation: 1, status: 'active' },
      },
    }))
    const botResult = createBot('token', {
      queueRepository,
      playersRepository,
      invitesStore,
      autoStartPolling: false,
    })
    const fakeBot = instances[0]
    const searchExecute = jest.spyOn(botResult.getContext('queue').registerSearch, 'execute')
    const searchHandler = fakeBot.textHandlers.find(({ pattern }) => pattern.test('/search')).handler

    await expect(searchHandler({
      chat: { id: 'queue' },
      from: { id: 1, username: 'new' },
      message_id: 14,
      text: '/search',
    })).resolves.toBeUndefined()

    expect(invitesStore.deleteByParticipant).toHaveBeenCalled()
    expect(searchExecute).not.toHaveBeenCalled()
    expect(fakeBot.sendMessage).toHaveBeenCalledWith(
      'queue',
      expect.stringContaining('проверить доступ'),
      { reply_to_message_id: 14 }
    )
    await expect(queueRepository.get()).resolves.toMatchObject({ searching: [] })
    await botResult.dispose()
  })

  test('falls back to the group when private delivery is unavailable', async () => {
    const playersRepository = {
      upsert: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn(async (username) =>
        username === '@bob' ? { username, userId: 42, generation: 2, banned: false } : null
      ),
    }
    const botResult = createBot('token', {
      queueRepository: queueWithActiveIdentity('@bob', 42, 2),
      playersRepository,
      autoStartPolling: false,
    })
    const fakeBot = instances[0]
    fakeBot.sendMessage.mockImplementation((chatId) =>
      chatId === 42 ? Promise.reject(new Error('private chat unavailable')) : Promise.resolve()
    )
    const playHandler = fakeBot.textHandlers.find(({ pattern }) => pattern.test('/play @bob')).handler

    await playHandler({
      chat: { id: 'queue' },
      from: { id: 1, username: 'alice' },
      message_id: 9,
      text: '/play @bob',
    }, ['/play @bob', '@bob'])

    expect(fakeBot.sendMessage).toHaveBeenCalledTimes(2)
    expect(fakeBot.sendMessage.mock.calls[0][0]).toBe(42)
    expect(fakeBot.sendMessage.mock.calls[1][0]).toBe('queue')
    expect(fakeBot.sendMessage.mock.calls[0][2].reply_markup.inline_keyboard).toHaveLength(1)
    expect(fakeBot.sendMessage.mock.calls[1][2].reply_markup.inline_keyboard).toHaveLength(2)
    expect(fakeBot.sendMessage.mock.calls[1][2].reply_markup.inline_keyboard[1][0].callback_data)
      .toMatch(/^direct_cancel:/)

    const cancelData = fakeBot.sendMessage.mock.calls[1][2].reply_markup.inline_keyboard[1][0].callback_data
    const callbackHandler = fakeBot.eventHandlers.get('callback_query')
    await callbackHandler({
      id: 'group-direct-cancel',
      from: { id: 1, username: 'alice' },
      data: cancelData,
      message: { chat: { id: 'queue' }, message_id: 101 },
    })
    expect(fakeBot.deleteMessage).toHaveBeenCalledWith('queue', 101)
    await botResult.dispose()
  })

  test('uses the current owner userId when a username is reused', async () => {
    const playersRepository = new InMemoryPlayersRepository()
    await playersRepository.upsert({ username: '@old', userId: 41 })
    await playersRepository.banOne('@old')
    await playersRepository.upsert({ username: '@new', userId: 41 })
    await playersRepository.upsert({ username: '@old', userId: 42 })

    const botResult = createBot('token', {
      queueRepository: queueWithActiveIdentity('@old', 42, 1),
      playersRepository,
      autoStartPolling: false,
    })
    const fakeBot = instances[0]
    const playHandler = fakeBot.textHandlers.find(({ pattern }) => pattern.test('/play @old')).handler

    await playHandler({
      chat: { id: 'queue' },
      from: { id: 1, username: 'alice' },
      message_id: 10,
      text: '/play @old',
    }, ['/play @old', '@old'])

    expect(fakeBot.sendMessage.mock.calls[0][0]).toBe(42)
    await botResult.dispose()
  })

  test('rejects a direct accept when the stored search belongs to an old owner', async () => {
    const queueRepository = new InMemoryQueueRepository(new QueueState({
      searching: ['@old'],
      searchingUserIds: { '@old': 42 },
      searchingIdentities: { '@old': { username: '@old', userId: 42, generation: 1 } },
      ownership: {
        '@old': { userId: 99, generation: 2, status: 'active' },
        '@bob': { userId: 2, generation: 2, status: 'active' },
      },
    }))
    const invitesStore = new InMemoryInvitesStore()
    const invite = await invitesStore.create({
      player: '@old',
      opponent: '@bob',
      playerIdentity: { username: '@old', userId: 42, generation: 1 },
      opponentIdentity: { username: '@bob', userId: 2, generation: 2 },
    })
    const playersRepository = {
      upsert: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn(async (username) => {
        if (username === '@old') return { username, userId: 99, banned: false }
        if (username === '@bob') return { username, userId: 2, generation: 2, banned: false }
        return null
      }),
    }
    const botResult = createBot('token', {
      queueRepository,
      playersRepository,
      invitesStore,
      autoStartPolling: false,
    })
    const fakeBot = instances[0]
    const callbackHandler = fakeBot.eventHandlers.get('callback_query')

    await callbackHandler({
      id: 'stale-direct-accept',
      from: { id: 2, username: 'bob' },
      data: `direct_accept:${invite.inviteId}`,
      message: { chat: { id: 'queue' }, message_id: 102 },
    })

    const state = await queueRepository.get()
    expect(state.searching).toEqual([])
    expect(state.queue).toEqual([])
    expect(fakeBot.answerCallbackQuery).toHaveBeenCalledWith(
      'stale-direct-accept',
      expect.objectContaining({ show_alert: true })
    )
    await botResult.dispose()
  })

  test('rejects play_with when the searching participant is banned', async () => {
    const aliceIdentity = { username: '@alice', userId: 1, generation: 1 }
    const bobIdentity = { username: '@bob', userId: 2, generation: 1 }
    const queueRepository = new InMemoryQueueRepository(new QueueState({
      searching: ['@alice'],
      searchingIdentities: { '@alice': aliceIdentity },
      ownership: {
        '@alice': { ...aliceIdentity, status: 'active' },
        '@bob': { ...bobIdentity, status: 'active' },
      },
    }))
    const playersRepository = {
      upsert: jest.fn().mockResolvedValue(undefined),
      isBanned: jest.fn(async (userId) => String(userId) === '1'),
    }
    const botResult = createBot('token', {
      queueRepository,
      playersRepository,
      autoStartPolling: false,
    })
    const fakeBot = instances[0]
    const context = botResult.getContext('queue')
    const addMatch = jest.spyOn(context.addMatch, 'execute')
    const callbackHandler = fakeBot.eventHandlers.get('callback_query')

    await callbackHandler({
      id: 'banned-play-with',
      from: { id: 2, username: 'bob' },
      data: 'i_want_to_play_with_:@alice',
      message: { chat: { id: 'queue' }, message_id: 103 },
    })

    expect(addMatch).not.toHaveBeenCalled()
    expect(fakeBot.answerCallbackQuery).toHaveBeenCalledWith(
      'banned-play-with',
      expect.objectContaining({ show_alert: true })
    )
    await botResult.dispose()
  })

  test('play_with accept announces the accepting player, not the original searcher', async () => {
    const aliceIdentity = { username: '@alice', userId: 1, generation: 1 }
    const bobIdentity = { username: '@bob', userId: 2, generation: 1 }
    const queueRepository = new InMemoryQueueRepository(new QueueState({
      searching: ['@alice'],
      searchingIdentities: { '@alice': aliceIdentity },
      ownership: {
        '@alice': { ...aliceIdentity, status: 'active' },
        '@bob': { ...bobIdentity, status: 'active' },
      },
    }))
    const botResult = createBot('token', {
      queueRepository,
      autoStartPolling: false,
    })
    const fakeBot = instances[0]
    const callbackHandler = fakeBot.eventHandlers.get('callback_query')

    await callbackHandler({
      id: 'accept-play-with',
      from: { id: 2, username: 'bob' },
      data: 'i_want_to_play_with_:@alice',
      message: { chat: { id: 'queue' }, message_id: 200 },
    })

    expect(fakeBot.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining('@bob'),
      expect.objectContaining({ chat_id: 'queue', message_id: 200 })
    )
    await botResult.dispose()
  })

  test('cancel_search silently deletes the announcement created in the group chat', async () => {
    const aliceIdentity = { username: '@alice', userId: 1, generation: 1 }
    const queueRepository = new InMemoryQueueRepository(new QueueState({
      searching: ['@alice'],
      searchingIdentities: { '@alice': aliceIdentity },
      ownership: { '@alice': { ...aliceIdentity, status: 'active' } },
    }))
    const botResult = createBot('token', {
      queueRepository,
      autoStartPolling: false,
    })
    const fakeBot = instances[0]
    const callbackHandler = fakeBot.eventHandlers.get('callback_query')

    await callbackHandler({
      id: 'cancel-search-group',
      from: { id: 1, username: 'alice' },
      data: 'i_want_to_cancel:@alice',
      message: { chat: { id: 'queue' }, message_id: 201 },
    })

    expect(fakeBot.deleteMessage).toHaveBeenCalledWith('queue', 201)
    expect(fakeBot.editMessageText).not.toHaveBeenCalled()
    expect(fakeBot.sendMessage).not.toHaveBeenCalled()
    await botResult.dispose()
  })

  test('cancel_search clears the keyboard on an inline announcement instead of deleting it', async () => {
    const aliceIdentity = { username: '@alice', userId: 1, generation: 1 }
    const queueRepository = new InMemoryQueueRepository(new QueueState({
      searching: ['@alice'],
      searchingIdentities: { '@alice': aliceIdentity },
      ownership: { '@alice': { ...aliceIdentity, status: 'active' } },
    }))
    const botResult = createBot('token', {
      queueRepository,
      autoStartPolling: false,
    })
    const fakeBot = instances[0]
    const callbackHandler = fakeBot.eventHandlers.get('callback_query')

    await callbackHandler({
      id: 'cancel-search-inline',
      from: { id: 1, username: 'alice' },
      data: 'i_want_to_cancel:@alice',
      inline_message_id: 'inline-search-message',
    })

    expect(fakeBot.deleteMessage).not.toHaveBeenCalled()
    expect(fakeBot.editMessageText).toHaveBeenCalledWith(
      expect.any(String),
      { inline_message_id: 'inline-search-message', reply_markup: { inline_keyboard: [] } }
    )
    await botResult.dispose()
  })

  test('cancels a renamed participant by current identity and rejects a foreign user', async () => {
    const renamedIdentity = { username: '@old', userId: 1, generation: 1 }
    const currentIdentity = { username: '@new', userId: 1, generation: 3 }
    const opponentIdentity = { username: '@other', userId: 2, generation: 1 }
    const queueRepository = new InMemoryQueueRepository(new QueueState({
      queue: [Match.create({
        player1: '@old',
        player2: '@other',
        startDate: new Date('2026-01-01T12:00:00Z'),
        endDate: new Date('2026-01-01T13:00:00Z'),
        participantIdentities: {
          '@old': renamedIdentity,
          '@other': opponentIdentity,
        },
      })],
      ownership: {
        '@new': { ...currentIdentity, status: 'active' },
        '@other': { ...opponentIdentity, status: 'active' },
      },
    }))
    const playersRepository = { upsert: jest.fn().mockResolvedValue(undefined) }
    const botResult = createBot('token', {
      queueRepository,
      playersRepository,
      autoStartPolling: false,
    })
    const fakeBot = instances[0]
    const callbackHandler = fakeBot.eventHandlers.get('callback_query')
    const callbackData = 'i_want_to_out:@old,@other'

    await callbackHandler({
      id: 'foreign-cancel',
      from: { id: 99, username: 'foreign' },
      data: callbackData,
      message: { chat: { id: 'queue' }, message_id: 104 },
    })

    await expect(queueRepository.get()).resolves.toMatchObject({ queue: expect.any(Array) })
    expect(fakeBot.answerCallbackQuery).toHaveBeenCalledWith(
      'foreign-cancel',
      expect.objectContaining({ show_alert: true })
    )

    await callbackHandler({
      id: 'renamed-cancel',
      from: { id: 1, username: 'new' },
      data: callbackData,
      message: { chat: { id: 'queue' }, message_id: 105 },
    })

    await expect(queueRepository.get()).resolves.toMatchObject({ queue: [] })
    await botResult.dispose()
  })

  test('keeps inline DM delivery cancelable by the initiator', async () => {
    const playersRepository = {
      upsert: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn(async (username) =>
        username === '@bob' ? { username, userId: 42, generation: 2, banned: false } : null
      ),
    }
    const botResult = createBot('token', {
      queueRepository: queueWithActiveIdentity('@bob', 42, 2),
      playersRepository,
      autoStartPolling: false,
    })
    const fakeBot = instances[0]
    const chosenHandler = fakeBot.eventHandlers.get('chosen_inline_result')

    await chosenHandler({
      from: { id: 1, username: 'alice' },
      result_id: `direct:${encodeURIComponent('@bob')}`,
      inline_message_id: 'inline-direct-message',
    })

    expect(fakeBot.sendMessage).toHaveBeenCalledTimes(1)
    expect(fakeBot.sendMessage.mock.calls[0][0]).toBe(42)
    const editCall = fakeBot.editMessageText.mock.calls.at(-1)
    const confirmationKeyboard = editCall[1].reply_markup
    expect(confirmationKeyboard.inline_keyboard[0][0].callback_data).toMatch(/^direct_cancel:/)

    const cancelHandler = fakeBot.eventHandlers.get('callback_query')
    await cancelHandler({
      id: 'inline-cancel',
      from: { id: 1, username: 'alice' },
      data: confirmationKeyboard.inline_keyboard[0][0].callback_data,
      inline_message_id: 'inline-direct-message',
    })

    expect(fakeBot.editMessageText).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ inline_message_id: 'inline-direct-message' })
    )
    await botResult.dispose()
  })
})
