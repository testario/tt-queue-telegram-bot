import { computed, reactive, readonly, watch } from 'vue'
import { useApi, usePlayersSync } from './useApi.js'
import { useTelegram } from './useTelegram.js'
import { markPlayerBanned, markPlayerVerified, markPlayerUnverified } from './useApi.js'

const state = reactive({
  players: [],
  loading: false,
  loaded: false,
})

// Версия sync, на которую отвечает текущий state.players — обновляется
// только по завершении запроса, поэтому "sync.version !== loadedVersion"
// после await однозначно говорит "пока запрос летел, пришёл ещё один
// players_update" (см. load() ниже), без отдельного флага-очереди.
let loadedVersion = -1
// Промис текущего летящего запроса — отдаём его конкурентным вызовам load()
// вместо того, чтобы давать им завершиться досрочно: иначе, например, App.vue
// await loadPlayers() резолвился бы раньше самого запроса, если тот уже
// запущен сработавшим watcher'ом, и ошибка загрузки не доходила бы до ветки
// .catch(markPlayerUnverified).
let inFlightPromise = null

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

// Модульный экспорт, а не часть usePlayers(): не зависит от state/SSE, а
// PlayerAvatar.vue вызывает его на каждую строку списка игроков — через
// usePlayers() это означало бы ещё один watch(sync.version) на каждый
// аватар (см. watcher ниже).
export const avatarUrl = (username) => {
  if (isMockMode) return mockAvatarUrl(username)
  return `/api/players/${username.replace('@', '')}/avatar`
}

export function usePlayers() {
  const { get } = useApi()
  const sync = usePlayersSync()

  // Тело запроса вынесено из load() — см. inFlightPromise выше.
  const fetchPlayers = async (requestedVersion) => {
    try {
      const data = await get('/players')
      const players = data.players ?? []
      const { user, player: currentPlayer } = useTelegram()
      // registrationState.verified начинается с null ("ещё не знаем") — это
      // единственное место, которое разрешает его в true/false. Разрешаем
      // определённо в обе стороны (а не только при verified: true), иначе
      // статус так и остаётся null и App.vue вечно показывает "проверяем
      // доступ" вместо логин-экрана для реально неподтверждённого игрока.
      // markPlayerUnverified() монотонен (см. useApi.js) и не откатывает уже
      // подтверждённого игрока обратно — иначе повторные фоновые рефетчи
      // этого файла (см. load() ниже) время от времени выкидывали бы
      // подтверждённого игрока на логин-экран.
      if (currentPlayer) {
        // Резолвим только когда currentPlayer уже известен — на некоторых
        // Telegram-клиентах initDataUnsafe.user.username ещё может быть не
        // готов к этому моменту (см. комментарий у computed players ниже), и
        // объявлять игрока неподтверждённым в этом случае было бы неверно.
        const self = findSelf(players, currentPlayer)
        if (self?.banned) markPlayerBanned()
        if (self?.verified) markPlayerVerified()
        else markPlayerUnverified()
      } else if (user) {
        // user уже известен, а username у него просто нет — это не "ещё не
        // готов", а терминальное состояние: authorized-эндпоинты (auth() в
        // router.js) всё равно ответят 400 username_required. Без этой ветки
        // такой игрок навечно виснет на "Проверяем доступ..." — self никогда
        // не найдётся, потому что currentPlayer никогда не станет истинным.
        markPlayerUnverified()
      }
      state.players = players
      state.loaded = true
      loadedVersion = requestedVersion
    } finally {
      state.loading = false
      inFlightPromise = null
    }
  }

  const load = async ({ force = false } = {}) => {
    if (state.loading) return inFlightPromise
    if (state.loaded && !force && sync.version === loadedVersion) return
    state.loading = true
    inFlightPromise = fetchPlayers(sync.version)
    // Ошибку fetchPlayers() здесь намеренно не глушим — она пробрасывается
    // вызывающему (см. .catch() у watcher'а ниже и у всех onMounted(load)).
    // Поэтому при неудаче строка ниже не выполняется, и список молча
    // остаётся на прежнем снимке до следующего players_update — не самый
    // свежий результат, зато без риска зациклить повторные запросы на
    // упавшем бэкенде.
    await inFlightPromise
    // Пока запрос летел, прилетел ещё один players_update — версия, за
    // которой мы гнались, уже не последняя, догоняем актуальную.
    if (sync.version !== loadedVersion) await load({ force: true })
  }

  // players_update прилетел по SSE (новый игрок, подтверждение регистрации,
  // бан/разбан — см. router.js) — переподгружаем список, иначе вкладка
  // "Игроки" и секция "Список игроков" в управлении застревают на снимке
  // самого первого захода до полной перезагрузки страницы. watch, а не
  // onMounted-эффект — см. тот же приём в useAdminPlayers.js. Ошибку гасим
  // здесь же: иначе непойманный reject на каждом неудачном фоновом рефетче
  // (частый случай — SSE как раз переподключается, когда сеть шалит).
  watch(() => sync.version, () => {
    load({ force: true }).catch((error) => {
      console.error('Не удалось обновить список игроков', error)
    })
  })

  // Себя в списке не показываем — ни вызвать на игру, ни забанить себя всё
  // равно нельзя, эти записи только мешают. Сделано computed'ом, а не
  // фильтром внутри load(): initDataUnsafe.user.username на некоторых
  // Telegram-клиентах может быть ещё не готов в момент самой первой загрузки,
  // поэтому currentPlayer читаем заново при каждом обращении к списку, а не
  // полагаемся на снепшот, сделанный в load() в момент того запроса.
  // Сравнение регистронезависимое — Telegram username регистронезависим.
  const players = computed(() => {
    const currentPlayer = useTelegram().player
    if (!currentPlayer) return state.players
    const currentLower = currentPlayer.toLowerCase()
    return state.players.filter((player) => player.username?.toLowerCase() !== currentLower)
  })

  const setBanned = (username, banned) => {
    const player = state.players.find((item) => item.username === username)
    if (player) player.banned = banned
  }

  return { state: readonly(state), players, load, setBanned }
}
