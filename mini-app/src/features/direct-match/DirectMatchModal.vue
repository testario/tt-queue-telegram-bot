<script setup>
import { ref, computed, onMounted } from 'vue'
import { useApi } from '@/composables/useApi.js'
import { usePlayers } from '@/composables/usePlayers.js'
import { useQueue } from '@/composables/useQueue.js'
import { useTelegram } from '@/composables/useTelegram.js'
import AppButton from '@/shared/ui/AppButton.vue'
import AppModal from '@/shared/ui/AppModal.vue'
import PlayerAvatar from '@/shared/ui/PlayerAvatar.vue'

defineEmits(['close'])
const modalRef = ref(null)
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

// Исключаем себя, тех, кто уже в очереди/играл, и участников любого висящего
// прямого приглашения — второе приглашение поверх первого осиротит его
// (тот же сценарий, что и с общим поиском в SearchPanel).
const unavailable = computed(() => new Set([
  currentPlayer,
  ...queueState.queue.flatMap((m) => [m.player1, m.player2]),
  ...queueState.played,
  ...queueState.pendingInvites.flatMap((invite) => [invite.player, invite.opponent]),
]))

// Фильтрация по строке поиска
const filteredPlayers = computed(() => {
  const q = search.value.toLowerCase().trim()
  return playersState.players.filter((p) => {
    if (p.banned) return false
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

// POST /api/direct возвращает reason от CreateDirectMatch/router.js — сюда не
// долетают reason-ы AddMatch (already_in_queue/same_player/...), этот запрос
// матч напрямую не создаёт.
const reasonToText = (reason) => ({
  opponent_played: 'Этот игрок уже играл сегодня',
  opponent_invite_pending: 'У этого игрока уже есть своё приглашение — дождитесь ответа на него',
  invite_exists: 'У вас уже есть отправленное приглашение — сначала отмените его',
}[reason] ?? 'Не удалось отправить приглашение')

const submit = async () => {
  const opponent = resolvedOpponent.value
  if (!opponent) return

  error.value = null

  const knownPlayer = playersState.players.find(
    (player) => player.username.toLowerCase() === opponent.toLowerCase()
  )
  if (knownPlayer?.banned) {
    error.value = 'Этого игрока нельзя пригласить: он заблокирован'
    return
  }

  loading.value = true

  try {
    const result = await api.post('/direct', { opponent })
    if (result.ok) {
      modalRef.value?.startClose()
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
  <AppModal ref="modalRef" aria-label="Пригласить игрока" content-class="direct-match-modal" @close="$emit('close')" v-slot="{ close }">
    <h3 class="direct-match-modal__title">Пригласить игрока</h3>

    <!-- Поиск по списку -->
    <input
      v-model="search"
      class="direct-match-modal__search"
      type="text"
      placeholder="Поиск по имени или @username"
      autofocus
    />

    <!-- Список известных игроков -->
    <div class="direct-match-modal__list">
      <div v-if="playersState.loading" class="direct-match-modal__hint">Загрузка...</div>

      <div v-else-if="!filteredPlayers.length" class="direct-match-modal__hint">
        Никого не найдено
      </div>

      <button
        v-for="p in filteredPlayers"
        :key="p.username"
        :class="[
          'direct-match-modal__player',
          { 'direct-match-modal__player--selected': selected?.username === p.username },
        ]"
        @click="selectPlayer(p)"
      >
        <PlayerAvatar :username="p.username" :size="40" />
        <span class="direct-match-modal__player-info">
          <span class="direct-match-modal__player-name">{{ p.displayName }}</span>
          <span class="direct-match-modal__player-username">{{ p.username }}</span>
        </span>
      </button>
    </div>

    <!-- Разделитель + ручной ввод -->
    <div class="direct-match-modal__divider">или введите username вручную</div>
    <input
      v-model="manualInput"
      class="direct-match-modal__input"
      type="text"
      placeholder="@username"
      @input="selected = null"
      @keydown.enter="submit"
    />

    <p v-if="error" class="direct-match-modal__error">{{ error }}</p>

    <div class="direct-match-modal__buttons">
      <AppButton :loading="loading" :disabled="!resolvedOpponent" @click="submit">
        Пригласить
      </AppButton>
      <AppButton variant="ghost" @click="close">
        Отмена
      </AppButton>
    </div>
  </AppModal>
</template>

<style lang="scss" scoped>
:deep(.direct-match-modal) {
  gap: 12px;
  padding: 24px 16px calc(24px + env(safe-area-inset-bottom, 0px));
}

.direct-match-modal {
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
