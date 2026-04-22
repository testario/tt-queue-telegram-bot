import { reactive, readonly } from 'vue'
import { useApi } from './useApi.js'

const state = reactive({
  players: [],
  loading: false,
  loaded: false,
})

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

  const avatarUrl = (username) =>
    `/api/players/${username.replace('@', '')}/avatar`

  // Удалить из локального кеша без повторного запроса (вызывается из PlayerManager)
  const remove = (username) => {
    const idx = state.players.findIndex((p) => p.username === username)
    if (idx !== -1) state.players.splice(idx, 1)
  }

  return { state: readonly(state), load, avatarUrl, remove }
}
