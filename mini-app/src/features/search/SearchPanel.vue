<script setup>
import { computed, ref } from 'vue'
import { useQueue } from '@/composables/useQueue.js'
import { useTelegram } from '@/composables/useTelegram.js'
import { useApi } from '@/composables/useApi.js'
import AppButton from '@/shared/ui/AppButton.vue'
import PlayerTag from '@/shared/ui/PlayerTag.vue'
import DirectMatchModal from '@/features/direct-match/DirectMatchModal.vue'

const { state } = useQueue()
const { player } = useTelegram()
const api = useApi()

const loading = ref(false)
const showDirectModal = ref(false)

const isSearching = computed(() => player && state.searching.includes(player))
const isInQueue = computed(() =>
  player && state.queue.some((m) => m.player1 === player || m.player2 === player)
)
const isInCurrentMatch = computed(() => {
  const m = state.queue[0]
  return m && (m.player1 === player || m.player2 === player)
})
const isPlayed = computed(() => player && state.played.includes(player))
const isIdle = computed(
  () => !isSearching.value && !isInQueue.value && !isPlayed.value && !!player
)

// Список ищущих без себя (чтобы показать кнопку "Сыграть с ним")
const othersSearching = computed(() =>
  state.searching.filter((p) => p !== player)
)

// Исходящее приглашение — кнопка "Отменить" для его автора
const myOutgoingInvite = computed(() =>
  state.pendingInvites?.find((inv) => inv.player === player) ?? null
)

const registerSearch = async () => {
  loading.value = true
  try {
    await api.post('/search')
  } finally {
    loading.value = false
  }
}

const cancelSearch = async () => {
  loading.value = true
  try {
    await api.del('/search')
  } finally {
    loading.value = false
  }
}

const cancelMatch = async () => {
  loading.value = true
  try {
    await api.del('/match')
  } finally {
    loading.value = false
  }
}

const playWith = async (opponent) => {
  loading.value = true
  try {
    await api.post('/match', { opponent })
  } finally {
    loading.value = false
  }
}

const cancelInvite = async () => {
  if (!myOutgoingInvite.value) return
  loading.value = true
  try {
    await api.post('/direct/cancel', { opponent: myOutgoingInvite.value.opponent })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="search-panel">

    <!-- Ищут соперника -->
    <div v-if="state.searching.length" class="search-panel__searching">
      <h2 class="search-panel__title">Ищут соперника</h2>

      <div
        v-for="searcher in state.searching"
        :key="searcher"
        class="search-panel__row"
      >
        <PlayerTag :name="searcher" />

        <!-- Кнопка "Сыграть с ним" — только для других игроков, и только если ты idle -->
        <AppButton
          v-if="searcher !== player && isIdle"
          variant="primary"
          :loading="loading"
          class="search-panel__play-btn"
          @click="playWith(searcher)"
        >
          Сыграть с ним
        </AppButton>
      </div>
    </div>

    <!-- Действия текущего пользователя -->
    <div class="search-panel__actions">

      <!-- Нет username -->
      <p v-if="!player" class="search-panel__hint">
        Установите Telegram username в настройках, чтобы участвовать в очереди
      </p>

      <!-- Уже играл -->
      <p v-else-if="isPlayed" class="search-panel__hint">
        Вы уже играли в этой части дня
      </p>

      <!-- Ищет соперника -->
      <template v-else-if="isSearching">
        <p class="search-panel__hint">Вы в поиске соперника</p>
        <AppButton variant="ghost" :loading="loading" @click="cancelSearch">
          Отменить поиск
        </AppButton>
      </template>

      <!-- В очереди (ждёт) -->
      <p v-else-if="isInQueue && !isInCurrentMatch" class="search-panel__hint">
        Вы в очереди — ожидайте своей пары
      </p>

      <!-- В текущем матче -->
      <template v-else-if="isInCurrentMatch">
        <p class="search-panel__hint">Вы играете прямо сейчас!</p>
        <AppButton variant="danger" :loading="loading" @click="cancelMatch">
          Нет времени на игры
        </AppButton>
      </template>

      <!-- Свободен — показываем кнопки поиска и прямого приглашения -->
      <template v-else-if="isIdle">
        <!-- Есть исходящее приглашение -->
        <template v-if="myOutgoingInvite">
          <p class="search-panel__hint">
            Вы пригласили {{ myOutgoingInvite.opponent }}
          </p>
          <AppButton variant="ghost" :loading="loading" @click="cancelInvite">
            Отменить приглашение
          </AppButton>
        </template>

        <!-- Нет исходящего приглашения -->
        <template v-else>
          <AppButton variant="primary" :loading="loading" @click="registerSearch">
            Ищу соперника
          </AppButton>
          <AppButton variant="ghost" @click="showDirectModal = true">
            Пригласить конкретного игрока
          </AppButton>
        </template>
      </template>

    </div>

    <!-- Модал прямого приглашения -->
    <DirectMatchModal v-if="showDirectModal" @close="showDirectModal = false" />

  </section>
</template>

<style lang="scss" scoped>
.search-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;

  &__title {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-hint);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }

  &__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 0;
    border-bottom: 1px solid var(--color-secondary-bg);

    &:last-child { border-bottom: none; }
  }

  &__play-btn {
    width: auto;
    padding: 8px 12px;
    font-size: 14px;
  }

  &__hint {
    font-size: 14px;
    color: var(--color-hint);
    text-align: center;
    padding: 4px 0;
  }

  &__actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
}
</style>
