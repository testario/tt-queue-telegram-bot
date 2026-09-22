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
  const { get, del } = useApi()
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

  // Себя в списке не показываем — иначе при недоступном Telegram
  // getChatAdministrators (fail-open, см. getChatAdminIds в router.js)
  // собственная запись может показаться неадмином, и в UI появится кнопка
  // забанить самого себя. Сравниваем по userId (initDataUnsafe.user.id), а
  // не по username, как в usePlayers: он здесь уже есть в чистом виде и не
  // зависит от того, успел ли Telegram отдать username к этому моменту.
  // Игрок без userId тоже отфильтровывается: без chat_id банить по
  // DELETE /api/players/by-id нечем — такая запись сломала бы :key и кнопку.
  const pending = computed(() => {
    const { user: currentUser } = useTelegram()
    // String(...): бэкенд везде сравнивает userId так же (router.js,
    // getChatAdminIds) — легаси-записи могли получить userId строкой, а не
    // числом (см. isInvalidLegacyUserId в MongoPlayersRepository).
    const currentUserId = currentUser?.id != null ? String(currentUser.id) : null
    return state.players.filter((p) =>
      p.userId != null
      && !p.banned
      && !p.verified
      && !p.isAdmin
      && String(p.userId) !== currentUserId
    )
  })

  const banByUserId = async (userId) => {
    await del(`/players/by-id/${userId}`)
    const player = state.players.find((p) => p.userId === userId)
    if (player) {
      player.banned = true
      markBannedEverywhere(player.username, true)
    }
  }

  return {
    state: readonly(state),
    pending,
    load,
    banByUserId,
  }
}
