import { computed, reactive, readonly, watch } from 'vue'
import { useApi, usePlayersSync } from './useApi.js'
import { usePlayers } from './usePlayers.js'
import { useTelegram } from './useTelegram.js'

const state = reactive({
  players: [],
  loading: false,
  loaded: false,
})

// Версия sync, на которую отвечает текущий state.players. Модульная (не
// component-scoped) переменная: вкладка "Управление" размонтирует
// PlayerManager при переключении на другую вкладку (см. activeView в
// App.vue) — вместе с ним умирает и watch ниже, а players_update, пришедший
// за это время, никто не подхватывает. Без отдельного счётчика загрузки
// guard "state.loaded && !force" на повторном onMounted().load() читал бы
// этот же устаревший снимок, потому что state.loaded остаётся true.
let loadedVersion = -1
// SSE-триггер, прилетевший, пока предыдущий запрос ещё летит — обычный
// "if (state.loading) return" в этом случае молча терял бы обновление до
// следующего, никак не гарантированного players_update.
let refetchQueued = false

// Синглтон, как usePlayers/useAdmin — все использования этого composable
// смотрят на один и тот же список, без дублирующих запросов. players_update
// приходит по общему SSE-каналу до того, как этот файл вообще существует
// (см. useQueue.js), поэтому первый реальный запрос уходит лениво, из load().
export function useAdminPlayers() {
  const { get, del, patch } = useApi()
  const sync = usePlayersSync()
  // Бан по chat_id меняет отдельный admin-стейт этого composable — но тот же
  // игрок обычно уже виден и в общем публичном списке (usePlayers, GET
  // /api/players), которым пользуются вкладка "Игроки" и другие экраны.
  // Без явной синхронизации туда забаненный там остался бы "активным" до
  // полной перезагрузки мини-аппа.
  const { setBanned: markBannedEverywhere } = usePlayers()

  const load = async ({ force = false } = {}) => {
    const requestedVersion = sync.version
    if (state.loading) {
      if (force || requestedVersion !== loadedVersion) refetchQueued = true
      return
    }
    if (state.loaded && !force && requestedVersion === loadedVersion) return
    state.loading = true
    try {
      const data = await get('/admin/players')
      state.players = data.players ?? []
      state.loaded = true
      loadedVersion = requestedVersion
    } catch (err) {
      console.error('Не удалось загрузить список игроков для панели управления', err)
    } finally {
      state.loading = false
    }
    if (refetchQueued) {
      refetchQueued = false
      await load({ force: true })
    }
  }

  // players_update прилетел по SSE — список мог устареть, перезапрашиваем.
  // watch, а не onMounted-эффект: пока компонент не смонтирован, сюда никто
  // не подписан, лишних запросов в фоне нет; Vue сам снимает watcher при
  // анмаунте компонента, использующего этот composable.
  watch(() => sync.version, () => { load({ force: true }) })

  // Общий фильтр для pending/bannedPending ниже: себя в списке не показываем
  // — иначе при недоступном Telegram getChatAdministrators (fail-open, см.
  // getChatAdminIds в router.js) собственная запись может показаться
  // неадмином, и в UI появится кнопка "Бан"/"Вернуть" на самого себя.
  // Сравниваем по userId (initDataUnsafe.user.id), а не по username, как в
  // usePlayers: он здесь уже есть в чистом виде и не зависит от того, успел
  // ли Telegram отдать username к этому моменту. Игрок без userId тоже
  // отфильтровывается: без chat_id ни забанить, ни разбанить по chat_id
  // нечем — такая запись сломала бы :key и кнопку.
  const selectUnverified = (banned) => {
    const { user: currentUser } = useTelegram()
    // String(...): бэкенд везде сравнивает userId так же (router.js,
    // getChatAdminIds) — легаси-записи могли получить userId строкой, а не
    // числом (см. isInvalidLegacyUserId в MongoPlayersRepository).
    const currentUserId = currentUser?.id != null ? String(currentUser.id) : null
    return state.players.filter((p) =>
      p.userId != null
      && Boolean(p.banned) === banned
      && !p.verified
      && String(p.userId) !== currentUserId
    )
  }

  // Неподтверждённые, ожидающие решения — админа сюда не пускаем: его нельзя
  // забанить (см. requireAdmin/cannot_ban_admin в router.js), кнопка "Бан"
  // тут была бы бессмысленной.
  const pending = computed(() => selectUnverified(false).filter((p) => !p.isAdmin))

  // Неподтверждённые, которых уже забанили — отдельно от pending выше и от
  // "Список игроков" (usePlayers/GET /api/players, который теперь вовсе не
  // отдаёт неподтверждённых): без своей секции такой игрок не пропадал бы
  // из вида, а молча оседал в общем списке, вперемешку с обычными игроками —
  // ровно то, чего просит не делать альфа-тест. isAdmin здесь НЕ фильтруем
  // (в отличие от pending): getChatAdminIds fail-open (router.js), поэтому
  // забанить админа чата всё же можно, пока Telegram недоступен — и его
  // нужно чем-то разбанить обратно, кнопка тут "Вернуть", а не "Бан".
  const bannedPending = computed(() => selectUnverified(true))

  const banByUserId = async (userId) => {
    await del(`/players/by-id/${userId}`)
    const player = state.players.find((p) => p.userId === userId)
    if (player) {
      player.banned = true
      markBannedEverywhere(player.username, true)
    }
  }

  // Разбан неподтверждённого — по username (единственный доступный ban-по-id
  // эндпоинт есть только для бана, см. DELETE /api/players/by-id/:userId), но
  // username к этому моменту уже есть в записи: identity апсертится ещё на
  // первом авторизованном запросе, задолго до подтверждения. markBannedEverywhere
  // здесь намеренно не зовём (в отличие от banByUserId) — неподтверждённого
  // в публичном списке usePlayers нет по определению (GET /api/players
  // отдаёт только verified), синхронизировать там нечего.
  const restoreByUserId = async (userId) => {
    const player = state.players.find((p) => p.userId === userId)
    if (!player) {
      console.error('Не удалось найти неподтверждённого игрока для разбана', userId)
      return
    }
    await patch(`/players/${player.username.replace('@', '')}`, { banned: false })
    player.banned = false
  }

  return {
    state: readonly(state),
    pending,
    bannedPending,
    load,
    banByUserId,
    restoreByUserId,
  }
}
