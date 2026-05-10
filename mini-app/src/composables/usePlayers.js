import { reactive, readonly } from 'vue'
import { useApi } from './useApi.js'

const state = reactive({
  players: [],
  loading: false,
  loaded: false,
})

const isMockMode =
  import.meta.env.DEV &&
  (import.meta.env.MODE === 'mock' || import.meta.env.VITE_USE_MOCKS === 'true')

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
      state.players = data.players ?? []
      state.loaded = true
    } finally {
      state.loading = false
    }
  }

  const avatarUrl = (username) => {
    if (isMockMode) return mockAvatarUrl(username)
    return `/api/players/${username.replace('@', '')}/avatar`
  }

  // Удалить из локального кеша без повторного запроса (вызывается из PlayerManager)
  const remove = (username) => {
    const idx = state.players.findIndex((p) => p.username === username)
    if (idx !== -1) state.players.splice(idx, 1)
  }

  return { state: readonly(state), load, avatarUrl, remove }
}
