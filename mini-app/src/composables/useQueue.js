import { reactive, readonly } from 'vue'
import { useApi, markPlayerBanned, markPlayerVerified, bumpPlayersSync } from './useApi.js'
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
  // Отличает "ещё ни разу не получили реальные данные" (блокирующий экран
  // ошибки — показывать пустую очередь как факт нельзя, мы его не знаем) от
  // "уже что-то показываем, но соединение сейчас шалит" (баннер поверх
  // данных, не блокирующий работу). Взводится один раз и навсегда — данные
  // уже показаны, откатывать этот флаг незачем.
  loaded: false,
  error: null,
})

let eventSource = null
// EventSource переподключается сам (это штатное поведение браузера), но
// onerror стреляет на каждый короткий обрыв, а не только на затяжной сбой.
// Без задержки баннер "Нет соединения" мигал бы при любом мимолётном обрыве
// сети — переподключение должно быть фоновым и не дёргать UI по мелочам.
const CONNECTION_LOST_DELAY_MS = 3000
let connectionLostTimer = null
// EventSource сам не переподключается после терминального CLOSED (например,
// сервер ответил не-2xx на сам запрос установки соединения) — без ручного
// повтора сессия молча теряла бы все будущие обновления. Фиксированный
// интервал, а не backoff: соединение легковесное, а бэкенд может подняться
// в любой момент — плата за более быстрый отклик после восстановления того
// стоит.
const RECONNECT_RETRY_MS = 5000

const clearConnectionLostTimer = () => {
  if (!connectionLostTimer) return
  clearTimeout(connectionLostTimer)
  connectionLostTimer = null
}

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
  state.loaded = true
}

const connectSse = () => {
  if (eventSource) return
  // initData прокидывается строкой запроса — EventSource не умеет ставить
  // кастомные заголовки. Нужен только чтобы сервер мог связать это
  // соединение с userId и адресно прислать player_banned в момент бана, а
  // не только при следующем обычном запросе к API.
  const { initData } = useTelegram()
  const url = initData ? `/api/events?initData=${encodeURIComponent(initData)}` : '/api/events'
  eventSource = new EventSource(url)

  eventSource.addEventListener('state_update', (e) => {
    applyState(JSON.parse(e.data))
    state.loading = false
  })

  // Бан игрока с открытым мини-аппом — сервер шлёт это событие сразу по
  // факту бана (см. sseManager.notifyUser в router.js), а не только когда
  // игрок сам за чем-то обратится к API. Закрываем соединение сразу же:
  // приложение и так закроется через отсчёт (см. App.vue), а держать канал
  // открытым забаненному игроку незачем — connectSse() больше не вызовется
  // повторно за эту сессию (init() — разовый вызов), поэтому обнулить
  // eventSource здесь безопасно.
  eventSource.addEventListener('player_banned', () => {
    markPlayerBanned()
    clearConnectionLostTimer()
    eventSource?.close()
    eventSource = null
  })

  // Подтверждение регистрации из чата (см. confirm_player-callback в bot.js
  // и релей в src/interfaces/webapp/index.js) — снимает логин-экран сразу,
  // не дожидаясь следующего обычного запроса. В отличие от player_banned
  // соединение не закрываем: игроку оно ещё понадобится для обычной работы.
  eventSource.addEventListener('player_verified', () => {
    markPlayerVerified()
  })

  // Список игроков мог измениться (новый игрок, подтверждение регистрации,
  // бан/разбан) — см. players_update в router.js. Payload здесь намеренно
  // пустой, актуальные данные подтягивают сами через usePlayersSync и там же
  // хранимую версию: usePlayers.js (вкладка "Игроки", список в управлении) и
  // useAdminPlayers.js (секция "Не подтверждены" в управлении).
  eventSource.addEventListener('players_update', () => {
    bumpPlayersSync()
  })

  eventSource.onerror = () => {
    // CLOSED — терминальный отказ (например, initData протухла и сервер
    // ответил 401/403/404): браузер сам больше не переподключится, onopen
    // никогда не придёт. Показываем баннер сразу, без 3-секундной задержки —
    // ждать тут нечего, а задержка на CONNECTING-обрывах существует именно
    // чтобы не мигать баннером во время штатных попыток реконнекта.
    if (eventSource?.readyState === EventSource.CLOSED) {
      clearConnectionLostTimer()
      state.error = 'connection_lost'
      eventSource = null
      setTimeout(connectSse, RECONNECT_RETRY_MS)
      return
    }
    if (connectionLostTimer) return
    connectionLostTimer = setTimeout(() => {
      state.error = 'connection_lost'
      connectionLostTimer = null
    }, CONNECTION_LOST_DELAY_MS)
  }

  eventSource.onopen = () => {
    clearConnectionLostTimer()
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
