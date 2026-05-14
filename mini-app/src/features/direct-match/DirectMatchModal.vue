<script setup>
import { ref, computed, onMounted } from 'vue'
import { useApi } from '@/composables/useApi.js'
import { usePlayers } from '@/composables/usePlayers.js'
import { useQueue } from '@/composables/useQueue.js'
import { useTelegram } from '@/composables/useTelegram.js'
import AppButton from '@/shared/ui/AppButton.vue'
import PlayerAvatar from '@/shared/ui/PlayerAvatar.vue'

const emit = defineEmits(['close'])
const api = useApi()
const { state: playersState, load } = usePlayers()
const { state: queueState } = useQueue()
const { player: currentPlayer } = useTelegram()

const search = ref('')
const manualInput = ref('')
const selected = ref(null)   // { username, displayName } — выбранный из списка
const loading = ref(false)
const error = ref(null)

onMounted(() => load())

// Исключаем себя и тех, кто уже в очереди/поиске/играл
const unavailable = computed(() => new Set([
  currentPlayer,
  ...queueState.queue.flatMap((m) => [m.player1, m.player2]),
  ...queueState.played,
]))

// Фильтрация по строке поиска
const filteredPlayers = computed(() => {
  const q = search.value.toLowerCase().trim()
  return playersState.players.filter((p) => {
    if (unavailable.value.has(p.username)) return false
    if (!q) return true
    return (
      p.username.toLowerCase().includes(q) ||
      p.displayName.toLowerCase().includes(q)
    )
  })
})

const selectPlayer = (p) => {
  selected.value = p
  manualInput.value = ''
  error.value = null
}

// Итоговый username для приглашения: из списка или из ручного ввода
const resolvedOpponent = computed(() => {
  if (selected.value) return selected.value.username
  const raw = manualInput.value.trim()
  if (!raw) return null
  return raw.startsWith('@') ? raw : `@${raw}`
})

const reasonToText = (reason) => ({
  already_played: 'Этот игрок уже играл сегодня',
  already_in_queue: 'Этот игрок уже в очереди',
  same_player: 'Нельзя пригласить себя',
  player1_not_searching: 'Игрок не в поиске',
}[reason] ?? 'Не удалось отправить приглашение')

const submit = async () => {
  const opponent = resolvedOpponent.value
  if (!opponent) return

  loading.value = true
  error.value = null

  try {
    const result = await api.post('/direct', { opponent })
    if (result.ok) {
      emit('close')
    } else {
      error.value = reasonToText(result.reason)
    }
  } catch {
    error.value = 'Ошибка соединения'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal">
      <h3 class="modal__title">Пригласить игрока</h3>

      <!-- Поиск по списку -->
      <input
        v-model="search"
        class="modal__search"
        type="text"
        placeholder="Поиск по имени или @username"
        autofocus
      />

      <!-- Список известных игроков -->
      <div class="modal__list">
        <div v-if="playersState.loading" class="modal__hint">Загрузка...</div>

        <div v-else-if="!filteredPlayers.length" class="modal__hint">
          Никого не найдено
        </div>

        <button
          v-for="p in filteredPlayers"
          :key="p.username"
          :class="['modal__player', { 'modal__player--selected': selected?.username === p.username }]"
          @click="selectPlayer(p)"
        >
          <PlayerAvatar :username="p.username" :size="40" />
          <div class="modal__player-info">
            <span class="modal__player-name">{{ p.displayName }}</span>
            <span class="modal__player-username">{{ p.username }}</span>
          </div>
        </button>
      </div>

      <!-- Разделитель + ручной ввод -->
      <div class="modal__divider">или введите username вручную</div>
      <input
        v-model="manualInput"
        class="modal__input"
        type="text"
        placeholder="@username"
        @input="selected = null"
        @keydown.enter="submit"
      />

      <p v-if="error" class="modal__error">{{ error }}</p>

      <div class="modal__buttons">
        <AppButton :loading="loading" :disabled="!resolvedOpponent" @click="submit">
          Пригласить
        </AppButton>
        <AppButton variant="ghost" @click="$emit('close')">
          Отмена
        </AppButton>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: flex-end;
  z-index: 100;
}

.modal {
  background: var(--color-surface);
  width: 100%;
  max-height: 80vh;
  border: 1px solid var(--color-border);
  border-radius: 28px 28px 0 0;
  padding: 24px 16px calc(24px + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 -14px 30px var(--color-card-shadow);

  &__title {
    font-size: 22px;
    font-weight: 900;
    text-align: center;
  }

  &__search, &__input {
    width: 100%;
    min-height: 50px;
    padding: 0 14px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-control);
    background: var(--color-surface-soft);
    color: var(--color-text);
    font-size: 15px;
    font-weight: 600;
    outline: none;

    &:focus { border-color: var(--color-button); }
  }

  &__list {
    overflow-y: auto;
    max-height: 280px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  &__player {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 62px;
    padding: 10px;
    border-radius: 18px;
    border: none;
    background: transparent;
    cursor: pointer;
    text-align: left;
    transition: background 0.1s;
    color: var(--color-text);

    &:hover, &--selected {
      background: var(--color-surface-soft);
    }

    &--selected {
      outline: 2px solid var(--color-button);
    }
  }

  &__player-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;
  }

  &__player-name {
    font-size: 15px;
    font-weight: 850;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__player-username {
    font-size: 13px;
    font-weight: 650;
    color: var(--color-hint);
  }

  &__hint {
    color: var(--color-hint);
    font-size: 14px;
    text-align: center;
    padding: 16px 0;
  }

  &__divider {
    font-size: 12px;
    color: var(--color-hint);
    text-align: center;
    position: relative;

    &::before, &::after {
      content: '';
      position: absolute;
      top: 50%;
      width: 28%;
      height: 1px;
      background: var(--color-border);
    }
    &::before { left: 0; }
    &::after { right: 0; }
  }

  &__error {
    font-size: 14px;
    color: var(--color-danger);
    text-align: center;
  }

  &__buttons {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
}
</style>
