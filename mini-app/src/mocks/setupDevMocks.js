const mockUser = {
  id: 10001,
  first_name: 'Dev',
  last_name: 'User',
  username: 'dev_user',
  language_code: 'ru',
}

const currentPlayer = `@${mockUser.username}`
const matchDurationMs = 1 * 60 * 1000

const createInitialPlayers = () => [
  { username: '@dev_user', displayName: 'Dev User' },
  { username: '@anna', displayName: 'Anna' },
  { username: '@boris', displayName: 'Boris' },
  { username: '@dima', displayName: 'Dima' },
  { username: '@ira', displayName: 'Ira' },
  { username: '@kate', displayName: 'Kate' },
  { username: '@maria', displayName: 'Maria' },
  { username: '@nick', displayName: 'Nick' },
  { username: '@oleg', displayName: 'Oleg' },
  { username: '@sveta', displayName: 'Sveta' },
  { username: '@lena', displayName: 'Lena' },
  { username: '@pavel', displayName: 'Pavel' },
  { username: '@roman', displayName: 'Roman' },
  { username: '@sonya', displayName: 'Sonya' },
  { username: '@vlad', displayName: 'Vlad' },
  { username: '@yulia', displayName: 'Yulia' },
]

const eventSources = new Set()

const createInitialState = () => {
  const now = Date.now()

  return {
    queue: [
      {
        player1: '@anna',
        player2: '@boris',
        status: 'playing',
        startDate: new Date(now - 0.5 * 60 * 1000).toISOString(),
        endDate: new Date(now + 0.5 * 60 * 1000).toISOString(),
      },
      {
        player1: '@dima',
        player2: '@ira',
        status: 'waiting',
        startDate: new Date(now + 0.5 * 60 * 1000).toISOString(),
        endDate: new Date(now + 1.5 * 60 * 1000).toISOString(),
      },
    ],
    searching: ['@kate', '@maria', '@nick'],
    played: ['@oleg', '@sveta'],
    paused: false,
    emergeActive: false,
    pendingInvites: [
      {
        player: '@kate',
        opponent: currentPlayer,
        createdAt: now - 60 * 1000,
      },
    ],
  }
}

let state = createInitialState()
let players = createInitialPlayers()

const normalizeUsername = (value) => {
  if (!value) return ''
  const [username] = String(value).trim().split(/\s+/)
  if (!username) return ''
  return username.startsWith('@') ? username : `@${username}`
}

const clone = (value) => JSON.parse(JSON.stringify(value))

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const getPayload = () => ({
  ...clone(state),
  serverTime: new Date().toISOString(),
})

const isInQueue = (player) =>
  state.queue.some((match) => match.player1 === player || match.player2 === player)

const getQueuedPlayers = () =>
  state.queue.flatMap((match) => [match.player1, match.player2])

const removeFromSearching = (player) => {
  state.searching = state.searching.filter((item) => item !== player)
}

const removeInvitesFor = (...usernames) => {
  state.pendingInvites = state.pendingInvites.filter((invite) => {
    const hasPlayer = usernames.includes(invite.player)
    const hasOpponent = usernames.includes(invite.opponent)
    return !hasPlayer && !hasOpponent
  })
}

const randomItem = (items) => {
  if (!items.length) return null
  const index = Math.floor(Math.random() * items.length)
  return items[index]
}

const randomPlayers = (count, excluded = []) => {
  const excludedSet = new Set(excluded)
  const candidates = players.filter((player) => !excludedSet.has(player.username))
  const result = []

  while (result.length < count && candidates.length) {
    const index = Math.floor(Math.random() * candidates.length)
    const [player] = candidates.splice(index, 1)
    result.push(player.username)
  }

  return result
}

const randomFreePlayers = (count, excluded = []) => {
  const busyPlayers = [
    currentPlayer,
    ...getQueuedPlayers(),
    ...state.played,
    ...state.searching,
    ...excluded,
  ]
  const result = randomPlayers(count, busyPlayers)

  if (result.length === count) return result
  return randomPlayers(count, [currentPlayer, ...excluded])
}

const createMatch = (player1, player2) => {
  const now = Date.now()
  const hasActiveMatch = state.queue.some((match) => match.status === 'playing')
  const startDate = hasActiveMatch ? now + state.queue.length * matchDurationMs : now
  const status = hasActiveMatch ? 'waiting' : 'playing'

  state.queue.push({
    player1,
    player2,
    status,
    startDate: new Date(startDate).toISOString(),
    endDate: new Date(startDate + matchDurationMs).toISOString(),
  })
}

const cleanupBeforeForcedMatch = (...usernames) => {
  usernames.forEach(removeFromSearching)
  state.played = state.played.filter((player) => !usernames.includes(player))
  removeInvitesFor(...usernames)
}

const startNextMatch = () => {
  const current = state.queue[0]
  if (!current || current.status === 'playing') return

  const now = Date.now()
  current.status = 'playing'
  current.startDate = new Date(now).toISOString()
  current.endDate = new Date(now + matchDurationMs).toISOString()
}

const broadcastState = () => {
  const eventData = JSON.stringify(getPayload())

  eventSources.forEach((eventSource) => {
    if (eventSource.readyState !== MockEventSource.OPEN) return
    const event = new MessageEvent('state_update', { data: eventData })
    eventSource.dispatchEvent(event)
  })
}

const createRandomQueueMatch = () => {
  const [player1, player2] = randomFreePlayers(2)
  if (!player1 || !player2) {
    return { ok: false, reason: 'not_enough_players' }
  }

  cleanupBeforeForcedMatch(player1, player2)
  createMatch(player1, player2)
  broadcastState()

  return { ok: true, player1, player2 }
}

const acceptTesterInviteByRandomUser = () => {
  const outgoingInvite = state.pendingInvites.find((invite) =>
    invite.player === currentPlayer && invite.opponent !== currentPlayer
  )
  const player = outgoingInvite?.opponent ?? randomItem(randomFreePlayers(1))

  if (!player) {
    return { ok: false, reason: 'not_enough_players' }
  }

  cleanupBeforeForcedMatch(currentPlayer, player)
  createMatch(currentPlayer, player)
  broadcastState()

  return { ok: true, player }
}

const receiveRandomInvite = () => {
  const player = randomItem(randomFreePlayers(1))
  if (!player) {
    return { ok: false, reason: 'not_enough_players' }
  }

  cleanupBeforeForcedMatch(player, currentPlayer)
  state.searching.push(player)
  state.pendingInvites.push({
    player,
    opponent: currentPlayer,
    createdAt: Date.now(),
  })
  broadcastState()

  return { ok: true, player }
}

const readBody = (init = {}) => {
  if (!init.body) return {}

  try {
    return JSON.parse(init.body)
  } catch (error) {
    console.error('Mock API: не удалось прочитать тело запроса', error)
    return {}
  }
}

const handleSearch = (method) => {
  if (method === 'POST') {
    if (state.played.includes(currentPlayer)) {
      return jsonResponse({ ok: true, status: 'played' })
    }

    if (isInQueue(currentPlayer)) {
      return jsonResponse({ ok: true, status: 'in_queue' })
    }

    if (state.searching.includes(currentPlayer)) {
      return jsonResponse({ ok: true, status: 'already_searching' })
    }

    state.searching.push(currentPlayer)
    broadcastState()
    return jsonResponse({ ok: true, status: 'added' })
  }

  if (method === 'DELETE') {
    const wasSearching = state.searching.includes(currentPlayer)
    removeFromSearching(currentPlayer)
    broadcastState()

    return jsonResponse({
      ok: wasSearching,
      status: wasSearching ? 'removed' : 'not_found',
    })
  }

  return jsonResponse({ error: 'method_not_allowed' }, 405)
}

const handleMatch = (method, init) => {
  if (method === 'POST') {
    const opponent = normalizeUsername(readBody(init).opponent)

    if (!opponent || opponent === currentPlayer) {
      return jsonResponse({ ok: false, reason: 'same_player' })
    }

    if (isInQueue(currentPlayer) || isInQueue(opponent)) {
      return jsonResponse({ ok: false, reason: 'already_in_queue' })
    }

    if (state.played.includes(currentPlayer) || state.played.includes(opponent)) {
      return jsonResponse({ ok: false, reason: 'already_played' })
    }

    if (!state.searching.includes(opponent)) {
      return jsonResponse({ ok: false, reason: 'player1_not_searching' })
    }

    removeFromSearching(currentPlayer)
    removeFromSearching(opponent)
    removeInvitesFor(currentPlayer, opponent)
    createMatch(opponent, currentPlayer)
    broadcastState()

    return jsonResponse({ ok: true })
  }

  if (method === 'DELETE') {
    const index = state.queue.findIndex((match) =>
      match.player1 === currentPlayer || match.player2 === currentPlayer
    )

    if (index === -1) {
      return jsonResponse({ ok: false, status: 'not_found' })
    }

    state.queue.splice(index, 1)
    startNextMatch()
    broadcastState()

    return jsonResponse({ ok: true, status: 'removed' })
  }

  return jsonResponse({ error: 'method_not_allowed' }, 405)
}

const handleDirect = (path, init) => {
  const body = readBody(init)

  if (path === '/api/direct') {
    const opponent = normalizeUsername(body.opponent)

    if (!opponent) {
      return jsonResponse({ ok: false, reason: 'opponent_required' })
    }

    if (opponent === currentPlayer) {
      return jsonResponse({ ok: false, reason: 'same_player' })
    }

    if (state.played.includes(opponent)) {
      return jsonResponse({ ok: false, reason: 'opponent_played' })
    }

    if (isInQueue(currentPlayer)) {
      return jsonResponse({ ok: false, reason: 'in_queue' })
    }

    if (!state.searching.includes(currentPlayer)) {
      state.searching.push(currentPlayer)
    }

    removeInvitesFor(currentPlayer)
    state.pendingInvites.push({
      player: currentPlayer,
      opponent,
      createdAt: Date.now(),
    })
    broadcastState()

    return jsonResponse({ ok: true })
  }

  if (path === '/api/direct/accept') {
    const player = normalizeUsername(body.player)
    const invite = state.pendingInvites.find((item) =>
      item.player === player && item.opponent === currentPlayer
    )

    if (!invite) {
      return jsonResponse({ ok: false, reason: 'invite_not_found' })
    }

    removeFromSearching(player)
    removeFromSearching(currentPlayer)
    removeInvitesFor(player, currentPlayer)
    createMatch(player, currentPlayer)
    broadcastState()

    return jsonResponse({ ok: true })
  }

  if (path === '/api/direct/decline') {
    const player = normalizeUsername(body.player)
    removeFromSearching(player)
    removeInvitesFor(player, currentPlayer)
    broadcastState()

    return jsonResponse({ ok: true })
  }

  if (path === '/api/direct/cancel') {
    removeFromSearching(currentPlayer)
    removeInvitesFor(currentPlayer)
    broadcastState()

    return jsonResponse({ ok: true })
  }

  return jsonResponse({ error: 'not_found' }, 404)
}

const handleAdmin = (path) => {
  if (path === '/api/admin/check') {
    return jsonResponse({ isAdmin: true })
  }

  if (path === '/api/admin/pause') {
    if (state.paused) {
      return jsonResponse({ ok: false, reason: 'already_paused' })
    }

    state.paused = true
    broadcastState()
    return jsonResponse({ ok: true })
  }

  if (path === '/api/admin/continue') {
    if (!state.paused && !state.emergeActive) {
      return jsonResponse({ ok: false, reason: 'not_paused' })
    }

    state.paused = false
    state.emergeActive = false
    broadcastState()
    return jsonResponse({ ok: true })
  }

  if (path === '/api/admin/emerge') {
    state.emergeActive = true
    broadcastState()
    return jsonResponse({ ok: true })
  }

  return jsonResponse({ error: 'not_found' }, 404)
}

const handlePlayers = (method, path) => {
  if (method === 'GET' && path === '/api/players') {
    return jsonResponse({ players: clone(players) })
  }

  if (method === 'DELETE' && path.startsWith('/api/players/')) {
    const username = normalizeUsername(decodeURIComponent(path.split('/').at(-1)))
    const index = players.findIndex((player) => player.username === username)

    if (index === -1) {
      return jsonResponse({ error: 'player_not_found' }, 404)
    }

    players.splice(index, 1)
    removeFromSearching(username)
    state.played = state.played.filter((player) => player !== username)
    removeInvitesFor(username)
    broadcastState()

    return jsonResponse({ ok: true })
  }

  if (method === 'GET' && path.endsWith('/avatar')) {
    return new Response(null, { status: 404 })
  }

  return jsonResponse({ error: 'not_found' }, 404)
}

const handleApiRequest = async (url, init = {}) => {
  const method = (init.method || 'GET').toUpperCase()
  const path = url.pathname

  if (method === 'GET' && path === '/api/state') {
    return jsonResponse(getPayload())
  }

  if (path.startsWith('/api/admin/')) {
    return handleAdmin(path)
  }

  if (path.startsWith('/api/players')) {
    return handlePlayers(method, path)
  }

  if (path === '/api/search') {
    return handleSearch(method)
  }

  if (path === '/api/match') {
    return handleMatch(method, init)
  }

  if (path.startsWith('/api/direct')) {
    return handleDirect(path, init)
  }

  return jsonResponse({ error: 'not_found' }, 404)
}

const setupTelegramMock = () => {
  const initData = new URLSearchParams({
    user: JSON.stringify(mockUser),
    auth_date: String(Math.floor(Date.now() / 1000)),
    hash: 'mock_hash',
  }).toString()

  window.Telegram = {
    ...(window.Telegram || {}),
    WebApp: {
      initData,
      initDataUnsafe: { user: mockUser },
      colorScheme: 'light',
      themeParams: {},
      ready: () => {},
      expand: () => {},
      close: () => {},
      showPopup: (options, callback) => {
        const confirmed = window.confirm(options.message)
        callback?.(confirmed ? 'ok' : 'cancel')
      },
    },
  }
}

class MockEventSource extends EventTarget {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2

  constructor(url) {
    super()
    this.url = url
    this.readyState = MockEventSource.CONNECTING
    eventSources.add(this)

    window.setTimeout(() => {
      if (this.readyState === MockEventSource.CLOSED) return

      this.readyState = MockEventSource.OPEN
      this.dispatchEvent(new Event('open'))
      this.onopen?.(new Event('open'))
      broadcastState()
    }, 0)
  }

  close() {
    this.readyState = MockEventSource.CLOSED
    eventSources.delete(this)
  }
}

const advanceQueue = () => {
  const current = state.queue[0]
  if (!current || current.status !== 'playing') return

  if (Date.now() < new Date(current.endDate).getTime()) return

  state.played.push(current.player1, current.player2)
  state.queue.shift()
  startNextMatch()
  broadcastState()
}

const setupApiMock = () => {
  setInterval(advanceQueue, 1000)

  const nativeFetch = window.fetch.bind(window)

  window.fetch = async (input, init = {}) => {
    const requestUrl = typeof input === 'string' ? input : input.url
    const url = new URL(requestUrl, window.location.origin)

    if (!url.pathname.startsWith('/api')) {
      return nativeFetch(input, init)
    }

    try {
      return await handleApiRequest(url, init)
    } catch (error) {
      console.error('Mock API: ошибка обработки запроса', error)
      return jsonResponse({ error: 'mock_error' }, 500)
    }
  }

  window.EventSource = MockEventSource
}

export function setupDevMocks() {
  setupTelegramMock()
  setupApiMock()

  window.__TT_QUEUE_MOCKS__ = {
    getState: () => getPayload(),
    createRandomQueueMatch,
    acceptTesterInviteByRandomUser,
    receiveRandomInvite,
    reset: () => {
      state = createInitialState()
      players = createInitialPlayers()
      broadcastState()
    },
  }
}
