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
const { state: playersState, load } = usePlayers()
const { state: queueState } = useQueue()
const { player: currentPlayer } = useTelegram()

const search = ref('')
const activeFilter = ref('all')
const invitingUsername = ref(null)

onMounted(() => load())

const queuedPlayers = computed(() =>
  queueState.queue.flatMap((match) => [match.player1, match.player2])
)

const unavailablePlayers = computed(() => new Set([
  currentPlayer,
  ...queuedPlayers.value,
  ...queueState.played,
]))

const playersWithStatus = computed(() =>
  playersState.players.map((player) => {
    const isSearching = queueState.searching.includes(player.username)
    const isQueued = queuedPlayers.value.includes(player.username)
    const isPlayed = queueState.played.includes(player.username)

    return {
      ...player,
      isSearching,
      isQueued,
      isPlayed,
      canInvite: Boolean(currentPlayer) && !unavailablePlayers.value.has(player.username),
    }
  })
)

const filteredPlayers = computed(() => {
  const query = search.value.toLowerCase().trim()

  return playersWithStatus.value.filter((player) => {
    if (activeFilter.value === 'searching' && !player.isSearching) return false
    if (activeFilter.value === 'available' && !player.canInvite) return false
    if (!query) return true

    const username = player.username.toLowerCase()
    const displayName = player.displayName.toLowerCase()
    return username.includes(query) || displayName.includes(query)
  })
})

const statusText = (player) => {
  if (player.username === currentPlayer) return 'это вы'
  if (player.isSearching) return 'ищет пару'
  if (player.isQueued) return 'в очереди'
  if (player.isPlayed) return 'играл сегодня'
  return 'доступен для приглашения'
}

const invite = async (username) => {
  invitingUsername.value = username
  try {
    await api.post('/direct', { opponent: username })
  } catch (error) {
    console.error('Не удалось отправить приглашение', error)
  } finally {
    invitingUsername.value = null
  }
}
</script>

<template>
  <div class="players-view">
    <header class="players-view__header">
      <h1>Игроки</h1>
    </header>

    <label class="players-view__search">
      <AppIcon name="search" />
      <input
        v-model="search"
        type="search"
        placeholder="Найти игрока по @username"
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

    <p v-if="playersState.loading" class="players-view__hint">Загрузка...</p>

    <section v-else class="players-view__list">
      <article
        v-for="player in filteredPlayers"
        :key="player.username"
        class="players-view__row"
      >
        <PlayerAvatar :username="player.username" :size="44" />
        <div class="players-view__info">
          <h2>{{ player.username }}</h2>
          <p>{{ statusText(player) }}</p>
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
          {{ player.isQueued ? 'В игре' : 'Недоступен' }}
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

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;

    h1 {
      color: var(--color-text);
      font-size: 28px;
      font-weight: 850;
      line-height: 1.15;
    }
  }

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
