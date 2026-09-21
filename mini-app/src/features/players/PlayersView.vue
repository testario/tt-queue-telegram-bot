<script setup>
import { computed, onMounted, ref } from 'vue'
import { useApi } from '@/composables/useApi.js'
import { usePlayers } from '@/composables/usePlayers.js'
import { useQueue } from '@/composables/useQueue.js'
import { useTelegram } from '@/composables/useTelegram.js'
import AppButton from '@/shared/ui/AppButton.vue'
import AppIcon from '@/shared/ui/AppIcon.vue'
import PlayerAvatar from '@/shared/ui/PlayerAvatar.vue'

const api = useApi()
const { state: playersState, players: visiblePlayers, load } = usePlayers()
const { state: queueState } = useQueue()
const { player: currentPlayer } = useTelegram()

const search = ref('')
const activeFilter = ref('all')
const invitingUsername = ref(null)
const inviteErrorText = ref('')

onMounted(() => load())

const queuedPlayers = computed(() =>
  queueState.queue.flatMap((match) => [match.player1, match.player2])
)

const currentPlayerInQueue = computed(() =>
  Boolean(currentPlayer) && queuedPlayers.value.includes(currentPlayer)
)

const currentPlayerPlayed = computed(() =>
  Boolean(currentPlayer) && queueState.played.includes(currentPlayer)
)

// Участники любого висящего прямого приглашения (и тот, кто позвал, и тот,
// кого позвали) — им сейчас не до нового приглашения: у позвавшего это
// приглашение держит его "поиск" на бэкенде, и второе приглашение поверх
// первого его осиротит (тот же сценарий, что и с общим поиском в SearchPanel).
const invitedPlayers = computed(() =>
  new Set(queueState.pendingInvites.flatMap((invite) => [invite.player, invite.opponent]))
)

// Только инициаторы — отдельно от invitedPlayers, потому что бейджу нужно
// различать "Ждёт ответа" (сам позвал) и "Вызван" (позвали его).
const invitedInitiators = computed(() =>
  new Set(queueState.pendingInvites.map((invite) => invite.player))
)

// Я сам уже кого-то позвал — второе приглашение поверх первого осиротит его
// (то же самое, что и isBusy в SearchPanel).
const currentPlayerHasOutgoingInvite = computed(() =>
  Boolean(currentPlayer) && queueState.pendingInvites.some((inv) => inv.player === currentPlayer)
)

// usePlayers() уже отфильтровывает currentPlayer при выдаче списка — этот пункт
// здесь дублирующий, но бесплатный: если фильтрация в usePlayers когда-нибудь
// уедет или список начнёт наполняться в обход неё, canInvite для собственной
// записи не откроется молча.
const unavailablePlayers = computed(() => new Set([
  currentPlayer,
  ...queuedPlayers.value,
  ...queueState.played,
  ...invitedPlayers.value,
]))

const playersWithStatus = computed(() =>
  visiblePlayers.value.map((player) => {
    const isSearching = queueState.searching.includes(player.username)
    const isQueued = queuedPlayers.value.includes(player.username)
    const isInvited = invitedPlayers.value.has(player.username)
    const isInviteInitiator = invitedInitiators.value.has(player.username)
    // По просьбе продукта в этом списке — "Фамилия Имя", в отличие от
    // displayName в PlayerManager/DirectMatchModal/боте ("Имя Фамилия").
    const fullName = [player.lastName, player.firstName].filter(Boolean).join(' ')
    // Токены, а не одна строка: чтобы запрос "Имя Фамилия" тоже находил игрока,
    // хотя на экране порядок обратный ("Фамилия Имя").
    const searchHaystack = `${player.username} ${player.firstName ?? ''} ${player.lastName ?? ''}`.toLowerCase()

    return {
      ...player,
      isSearching,
      isQueued,
      isInvited,
      isInviteInitiator,
      fullName,
      searchHaystack,
      canInvite: Boolean(currentPlayer)
        && !player.banned // дублирует фильтр в filteredPlayers — дешёвая защита на случай, если он уедет
        && !unavailablePlayers.value.has(player.username)
        && !currentPlayerInQueue.value
        && !currentPlayerPlayed.value
        && !currentPlayerHasOutgoingInvite.value,
    }
  })
)

const filteredPlayers = computed(() => {
  const query = search.value.toLowerCase().trim()
  const queryTokens = query ? query.split(/\s+/) : []

  return playersWithStatus.value.filter((player) => {
    if (player.banned) return false
    if (activeFilter.value === 'searching' && !player.isSearching) return false
    if (activeFilter.value === 'available' && !player.canInvite) return false
    return queryTokens.every((token) => player.searchHaystack.includes(token))
  })
})

// POST /api/direct отвечает 200 и { ok: false, reason } даже при отказе
// (например reason: 'opponent_invite_pending', если оппонента позвал кто-то
// ещё, пока список обновлялся) — такие отказы не бросают исключение, их
// нужно разбирать отдельно, иначе кнопка просто гаснет без объяснения.
const inviteReasonToText = (reason) => ({
  opponent_invite_pending: 'У этого игрока уже есть своё приглашение — дождитесь ответа на него',
  invite_exists: 'У вас уже есть отправленное приглашение — сначала отмените его',
  opponent_played: 'Этот игрок уже играл сегодня',
}[reason] ?? 'Не удалось отправить приглашение')

const invite = async (username) => {
  invitingUsername.value = username
  inviteErrorText.value = ''
  try {
    const result = await api.post('/direct', { opponent: username })
    if (!result.ok) inviteErrorText.value = inviteReasonToText(result.reason)
  } catch (error) {
    console.error('Не удалось отправить приглашение', error)
    inviteErrorText.value = 'Ошибка соединения'
  } finally {
    invitingUsername.value = null
  }
}
</script>

<template>
  <div class="players-view">
    <label class="players-view__search">
      <AppIcon name="search" />
      <input
        v-model="search"
        type="search"
        placeholder="Найти игрока по имени или @username"
      />
    </label>

    <div class="players-view__filters">
      <button
        :class="['players-view__filter', { 'players-view__filter--active': activeFilter === 'all' }]"
        type="button"
        @click="activeFilter = 'all'"
      >
        Все
      </button>
      <button
        :class="['players-view__filter', { 'players-view__filter--active': activeFilter === 'searching' }]"
        type="button"
        @click="activeFilter = 'searching'"
      >
        Ищут пару
      </button>
      <button
        :class="['players-view__filter', { 'players-view__filter--active': activeFilter === 'available' }]"
        type="button"
        @click="activeFilter = 'available'"
      >
        Не играли
      </button>
    </div>

    <div v-if="currentPlayerInQueue" class="players-view__played-banner">
      Вы уже в очереди — приглашения недоступны
    </div>
    <div v-else-if="currentPlayerPlayed" class="players-view__played-banner">
      Вы уже играли в этой части дня — приглашения недоступны
    </div>
    <div v-else-if="currentPlayerHasOutgoingInvite" class="players-view__played-banner">
      Вы уже кого-то позвали — дождитесь ответа, прежде чем звать другого
    </div>

    <p v-if="inviteErrorText" class="players-view__error-banner">{{ inviteErrorText }}</p>

    <p v-if="playersState.loading" class="players-view__hint">Загрузка...</p>

    <section v-else class="players-view__list">
      <article
        v-for="player in filteredPlayers"
        :key="player.username"
        class="players-view__row"
      >
        <PlayerAvatar :username="player.username" :size="44" />
        <div class="players-view__info">
          <h2>{{ player.fullName || player.username }}</h2>
          <p v-if="player.fullName">{{ player.username }}</p>
        </div>
        <AppButton
          v-if="player.canInvite"
          class="players-view__invite"
          :loading="invitingUsername === player.username"
          @click="invite(player.username)"
        >
          Позвать
        </AppButton>
        <span v-else class="players-view__badge">
          {{ player.isQueued ? 'В игре' : (player.isInviteInitiator ? 'Ждёт ответа' : (player.isInvited ? 'Вызван' : 'Недоступен')) }}
        </span>
      </article>

      <p v-if="!filteredPlayers.length" class="players-view__hint">
        Подходящих игроков нет
      </p>
    </section>
  </div>
</template>

<style lang="scss" scoped>
.players-view {
  display: flex;
  flex-direction: column;
  gap: 14px;

  &__search {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 50px;
    padding: 0 14px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-control);
    background: var(--color-surface);
    color: var(--color-muted);

    svg {
      width: 19px;
      height: 19px;
      flex: 0 0 auto;
    }

    input {
      min-width: 0;
      width: 100%;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--color-text);
      font-size: 15px;
      font-weight: 600;

      &::placeholder {
        color: var(--color-muted);
      }
    }
  }

  &__filters {
    display: flex;
    gap: 8px;
    overflow-x: auto;
  }

  &__filter {
    flex: 0 0 auto;
    padding: 9px 13px;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: var(--color-surface);
    color: var(--color-text-secondary);
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;

    &--active {
      border-color: var(--color-button);
      background: var(--color-button);
      color: var(--color-button-text);
    }
  }

  &__played-banner {
    padding: 12px 14px;
    border-radius: 18px;
    background: color-mix(in srgb, var(--color-warning), transparent 84%);
    color: var(--color-warning);
    font-size: 14px;
    font-weight: 800;
    text-align: center;
  }

  &__error-banner {
    padding: 12px 14px;
    border-radius: 18px;
    background: color-mix(in srgb, var(--color-danger), transparent 84%);
    color: var(--color-danger);
    font-size: 14px;
    font-weight: 800;
    text-align: center;
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  &__row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 72px;
    padding: 12px;
    border: 1px solid var(--color-border);
    border-radius: 18px;
    background: var(--color-surface);
  }

  &__info {
    min-width: 0;
    flex: 1;

    h2,
    p {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    h2 {
      color: var(--color-text);
      font-size: 17px;
      font-weight: 850;
    }

    p {
      margin-top: 3px;
      color: var(--color-text-secondary);
      font-size: 12px;
      font-weight: 650;
    }
  }

  &__invite {
    width: 92px;
    min-height: 42px;
    padding: 0 12px;
    border-radius: 14px;
    font-size: 14px;
    flex: 0 0 auto;
  }

  &__badge {
    flex: 0 0 auto;
    padding: 10px 12px;
    border-radius: 14px;
    background: var(--color-surface-soft);
    color: var(--color-muted);
    font-size: 12px;
    font-weight: 800;
  }

  &__hint {
    padding: 24px 0;
    color: var(--color-hint);
    font-size: 14px;
    font-weight: 650;
    text-align: center;
  }
}
</style>
