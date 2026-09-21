import { computed, reactive, readonly } from 'vue'
import { useApi } from './useApi.js'
import { useTelegram } from './useTelegram.js'
import { markPlayerBanned, markPlayerVerified } from './useApi.js'

const state = reactive({
  players: [],
  loading: false,
  loaded: false,
})

const isMockMode =
  import.meta.env.DEV &&
  (import.meta.env.MODE === 'mock' || import.meta.env.VITE_USE_MOCKS === 'true')

// Telegram username регистронезависим (см. тот же комментарий у computed
// players ниже) — сравнение через ===, как в этом self-скане было раньше,
// молча не находило себя при несовпадении регистра, и с этой фичей такой
// промах означает не косметику, а бессрочную блокировку логин-экраном.
const findSelf = (players, currentPlayer) => {
  if (!currentPlayer) return null
  const currentLower = currentPlayer.toLowerCase()
  return players.find((player) => player.username?.toLowerCase() === currentLower) ?? null
}

const mockAvatarUrl = (username) => {
  const label = username.replace('@', '').slice(0, 1).toUpperCase()
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80">
      <rect width="80" height="80" rx="40" fill="#e8eef6"/>
      <text x="40" y="48" text-anchor="middle" font-family="Arial, sans-serif" font-size="32" font-weight="700" fill="#2481cc">${label}</text>
    </svg>
  `

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

export function usePlayers() {
  const { get } = useApi()

  const load = async () => {
    if (state.loaded || state.loading) return
    state.loading = true
    try {
      const data = await get('/players')
      const players = data.players ?? []
      const self = findSelf(players, useTelegram().player)
      if (self?.banned) markPlayerBanned()
      if (self?.verified) markPlayerVerified()
      state.players = players
      state.loaded = true
    } finally {
      state.loading = false
    }
  }

  // Себя в списке не показываем — ни вызвать на игру, ни забанить себя всё
  // равно нельзя, эти записи только мешают. Сделано computed'ом, а не
  // фильтром внутри load(): initDataUnsafe.user.username на некоторых
  // Telegram-клиентах может быть ещё не готов в момент самой первой загрузки
  // (load() выполняется один раз за сессию), поэтому currentPlayer читаем
  // заново при каждом обращении к списку, а не полагаемся на снепшот.
  // Сравнение регистронезависимое — Telegram username регистронезависим.
  const players = computed(() => {
    const currentPlayer = useTelegram().player
    if (!currentPlayer) return state.players
    const currentLower = currentPlayer.toLowerCase()
    return state.players.filter((player) => player.username?.toLowerCase() !== currentLower)
  })

  const avatarUrl = (username) => {
    if (isMockMode) return mockAvatarUrl(username)
    return `/api/players/${username.replace('@', '')}/avatar`
  }

  // Удалить из локального кеша без повторного запроса (вызывается из PlayerManager)
  const remove = (username) => {
    const idx = state.players.findIndex((p) => p.username === username)
    if (idx !== -1) state.players.splice(idx, 1)
  }

  const setBanned = (username, banned) => {
    const player = state.players.find((item) => item.username === username)
    if (player) player.banned = banned
  }

  return { state: readonly(state), players, load, avatarUrl, remove, setBanned }
}
