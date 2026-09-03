<script setup>
import { computed, ref } from 'vue'
import { useQueue } from '@/composables/useQueue.js'
import { useTelegram } from '@/composables/useTelegram.js'
import { useApi } from '@/composables/useApi.js'
import AppButton from '@/shared/ui/AppButton.vue'
import AppIcon from '@/shared/ui/AppIcon.vue'
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
  } catch (error) {
    console.error('Не удалось начать поиск', error)
  } finally {
    loading.value = false
  }
}

const cancelSearch = async () => {
  loading.value = true
  try {
    await api.del('/search')
  } catch (error) {
    console.error('Не удалось отменить поиск', error)
  } finally {
    loading.value = false
  }
}

const cancelMatch = async () => {
  loading.value = true
  try {
    await api.del('/match')
  } catch (error) {
    console.error('Не удалось отменить матч', error)
  } finally {
    loading.value = false
  }
}

const playWith = async (opponent) => {
  loading.value = true
  try {
    await api.post('/match', { opponent })
  } catch (error) {
    console.error('Не удалось создать матч', error)
  } finally {
    loading.value = false
  }
}

const cancelInvite = async () => {
  if (!myOutgoingInvite.value) return
  loading.value = true
  try {
    await api.post('/direct/cancel', { opponent: myOutgoingInvite.value.opponent })
  } catch (error) {
    console.error('Не удалось отменить приглашение', error)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="search-panel">

    <!-- Ищут соперника -->
    <div v-if="othersSearching.length" class="search-panel__searching">
      <h2 class="search-panel__title">Ищут соперника</h2>

      <div
        v-for="searcher in othersSearching"
        :key="searcher"
        class="search-panel__row"
      >
        <PlayerTag :name="searcher" />

        <!-- Кнопка "Сыграть с ним" — только для других игроков, и только если ты idle -->
        <AppButton
          v-if="isIdle"
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
          <AppButton class="search-panel__cta" variant="primary" :loading="loading" @click="registerSearch">
            <AppIcon name="play" />
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
  gap: 14px;

  &__title {
    font-size: 15px;
    font-weight: 800;
    color: var(--color-hint);
  }

  &__searching {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  &__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 64px;
    padding: 12px;
    border: 1px solid var(--color-border);
    border-radius: 18px;
    background: var(--color-surface);
  }

  &__play-btn {
    width: auto;
    min-height: 40px;
    padding: 0 12px;
    border-radius: 14px;
    font-size: 14px;
  }

  &__hint {
    font-size: 14px;
    color: var(--color-hint);
    text-align: center;
    padding: 12px;
    border-radius: 18px;
    background: var(--color-surface);
  }

  &__actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  &__cta {
    position: sticky;
    bottom: 8px;
    z-index: 5;

    svg {
      width: 18px;
      height: 18px;
    }
  }
}
</style>
