<script setup>
import { ref, onMounted, computed } from 'vue'
import { useAdmin } from '@/composables/useAdmin.js'
import { useQueue } from '@/composables/useQueue.js'
import AppButton from '@/shared/ui/AppButton.vue'
import PlayerManager from './PlayerManager.vue'

const { isAdmin, checkAdmin, pause, resume, emerge } = useAdmin()
const { state } = useQueue()

const loading = ref(false)
const result = ref(null)  // последний результат действия

onMounted(() => checkAdmin())

const isPaused = computed(() => state.paused)
const isEmergeActive = computed(() => state.emergeActive)
const hasActiveMatch = computed(() => {
  const m = state.queue[0]
  return m?.status === 'playing'
})

const handleAction = async (action) => {
  loading.value = true
  result.value = null
  try {
    const res = await action()
    result.value = { ok: res?.ok !== false, reason: res?.reason }
  } catch {
    result.value = { ok: false, reason: 'connection_error' }
  } finally {
    loading.value = false
  }
}

const confirmAndAct = async (message, action) => {
  const tg = window.Telegram?.WebApp
  if (tg?.showPopup) {
    tg.showPopup(
      { message, buttons: [{ id: 'ok', text: 'Подтвердить' }, { type: 'cancel' }] },
      (buttonId) => { if (buttonId === 'ok') handleAction(action) }
    )
  } else {
    if (window.confirm(message)) handleAction(action)
  }
}

const errorMessages = {
  already_paused: 'Пауза уже активна',
  not_paused: 'Пауза не активна',
  admin_required: 'Требуются права администратора',
  connection_error: 'Ошибка соединения',
}

const resultText = computed(() => {
  if (!result.value) return null
  if (result.value.ok) return null
  return errorMessages[result.value.reason] || 'Не удалось выполнить действие'
})
</script>

<template>
  <!-- Панель не рендерится до завершения проверки прав -->
  <section v-if="isAdmin" class="admin-panel">

    <h2 class="admin-panel__title">Управление очередью</h2>

    <!-- Статус -->
    <div class="admin-panel__status">
      <span :class="['admin-panel__badge', isPaused ? 'admin-panel__badge--warn' : 'admin-panel__badge--ok']">
        {{ isPaused ? 'На паузе' : 'Активна' }}
      </span>
      <span v-if="isEmergeActive" class="admin-panel__badge admin-panel__badge--danger">
        Экстренная пауза
      </span>
    </div>

    <!-- Ошибка последнего действия -->
    <p v-if="resultText" class="admin-panel__error">{{ resultText }}</p>

    <!-- Действия -->
    <div class="admin-panel__actions">

      <!-- Пауза (только если не на паузе) -->
      <AppButton
        v-if="!isPaused"
        variant="ghost"
        :loading="loading"
        @click="handleAction(pause)"
      >
        Поставить на паузу
      </AppButton>

      <!-- Продолжить (если на паузе или emerge активен) -->
      <AppButton
        v-if="isPaused || isEmergeActive"
        variant="primary"
        :loading="loading"
        @click="handleAction(resume)"
      >
        Продолжить очередь
      </AppButton>

      <!-- Экстренная пауза (только если есть активный матч и нет других пауз) -->
      <AppButton
        v-if="hasActiveMatch && !isPaused && !isEmergeActive"
        variant="danger"
        :loading="loading"
        @click="confirmAndAct('Экстренная пауза остановит текущий матч. Продолжить?', emerge)"
      >
        Экстренная пауза матча
      </AppButton>

    </div>

    <!-- Управление списком игроков -->
    <PlayerManager />

  </section>
</template>

<style lang="scss" scoped>
.admin-panel {
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  display: flex;
  flex-direction: column;
  gap: 12px;

  &__title {
    font-size: 15px;
    font-weight: 800;
    color: var(--color-hint);
  }

  &__status {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  &__badge {
    font-size: 13px;
    font-weight: 800;
    padding: 7px 10px;
    border-radius: 999px;

    &--ok      { background: color-mix(in srgb, var(--color-success), transparent 84%); color: var(--color-success); }
    &--warn    { background: color-mix(in srgb, var(--color-warning), transparent 84%); color: var(--color-warning); }
    &--danger  { background: color-mix(in srgb, var(--color-danger), transparent 84%); color: var(--color-danger); }
  }

  &__error {
    font-size: 14px;
    color: var(--color-danger);
  }

  &__actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
}
</style>
