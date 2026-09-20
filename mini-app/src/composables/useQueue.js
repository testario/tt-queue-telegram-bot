import { reactive, readonly } from 'vue'
import { useApi } from './useApi.js'
import { useTelegram } from './useTelegram.js'

const state = reactive({
  queue: [],
  searching: [],
  played: [],
  paused: false,
  emergeActive: false,
  serverTime: null,
  pendingInvites: [],
  loading: true,
  error: null,
})

let eventSource = null

// SSE и обычные ответы API приходят по разным соединениям без гарантии
// порядка — более старый снимок (например, устаревшее state_update,
// отправленное параллельно чужим действием) может прийти позже свежего
// ответа явного запроса. revision — монотонный счётчик версий состояния на
// бэкенде, надёжный маркер порядка (в отличие от serverTime, который
// штампуется уже после чтения состояния и может не совпасть по порядку при
// параллельных запросах). Сбрасывается при каждом (пере)открытии SSE-канала:
// после рестарта backend/Redis revision на сервере начинается заново, и без
// сброса клиент навсегда отбрасывал бы уже актуальные, но "меньшие" снимки.
let lastAppliedRevision = -1

const applyState = (data) => {
  const incomingRevision = typeof data.revision === 'number' ? data.revision : null
  if (incomingRevision !== null) {
    if (incomingRevision < lastAppliedRevision) return
    lastAppliedRevision = incomingRevision
  }

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
  state.pendingInvites = data.pendingInvites || []
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
    // Переподключение могло произойти после рестарта backend/Redis — revision
    // там мог начаться заново, поэтому не считаем прежний максимум актуальным.
    lastAppliedRevision = -1
  }
}

export function useQueue() {
  const { get, del } = useApi()
  const { player } = useTelegram()

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

  // Отмена матча — не ждём отдельного SSE-события: подтягиваем свежее
  // состояние тем же запросом, чтобы UI обновился сразу же, синхронно с
  // ответом сервера, а не только после следующего пришедшего state_update.
  const cancelMatch = async () => {
    await del('/match')
    try {
      applyState(await get('/state'))
    } catch {
      // SSE рано или поздно догонит актуальное состояние — не мешаем успешной отмене.
    }
  }

  return { state: readonly(state), player, init, cancelMatch }
}
