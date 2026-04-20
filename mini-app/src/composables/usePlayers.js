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

  return { state: readonly(state), load, avatarUrl }
}
