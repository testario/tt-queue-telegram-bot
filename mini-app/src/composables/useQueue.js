import { reactive, readonly } from 'vue'
import { useApi } from './useApi.js'

const state = reactive({
  queue: [],
  searching: [],
  played: [],
  paused: false,
  emergeActive: false,
  serverTime: null,
  loading: true,
  error: null,
})

let eventSource = null

const applyState = (data) => {
  state.queue = (data.queue || []).map((m) => ({
    ...m,
    startDate: new Date(m.startDate),
    endDate: new Date(m.endDate),
  }))
  state.searching = data.searching || []
  state.played = data.played || []
  state.paused = data.paused || false
  state.emergeActive = data.emergeActive || false
  state.serverTime = data.serverTime ? new Date(data.serverTime) : null
}

const connectSse = () => {
  if (eventSource) return
  eventSource = new EventSource('/api/events')

  eventSource.addEventListener('state_update', (e) => {
    applyState(JSON.parse(e.data))
    state.loading = false
  })

  eventSource.onerror = () => {
    state.error = 'connection_lost'
  }

  eventSource.onopen = () => {
    state.error = null
  }
}

export function useQueue() {
  const { get } = useApi()

  const init = async () => {
    try {
      const data = await get('/state')
      applyState(data)
    } catch {
      state.error = 'load_failed'
    } finally {
      state.loading = false
      connectSse()
    }
  }

  return { state: readonly(state), init }
}
