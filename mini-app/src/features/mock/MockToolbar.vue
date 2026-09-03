<script setup>
import { ref } from 'vue'
import { useApi } from '@/composables/useApi.js'
import AppButton from '@/shared/ui/AppButton.vue'

const api = useApi()
const message = ref(null)
const loading = ref(false)

const runAction = async (apiCall, successText) => {
  loading.value = true
  message.value = null
  try {
    const result = await apiCall()
    message.value = result.ok === false
      ? 'Недостаточно игроков'
      : (typeof successText === 'function' ? successText(result) : successText)
  } catch {
    message.value = 'Ошибка запроса'
  } finally {
    loading.value = false
  }
}

const addPair = () => runAction(
  () => api.post('/dev/add-pair'),
  (r) => `В очередь: ${r.player1} и ${r.player2}`
)

const acceptInvite = () => runAction(
  () => api.post('/dev/accept-invite'),
  (r) => `${r.player} принял приглашение`
)

const receiveInvite = () => runAction(
  () => api.post('/dev/receive-invite'),
  (r) => `${r.player} прислал приглашение`
)

const markPlayed = () => runAction(
  () => api.post('/dev/mark-played'),
  () => 'Отмечен как сыгравший'
)

const reset = async () => {
  loading.value = true
  message.value = null
  try {
    const { DEV_PLAYERS, createInitialDevState } = await import('@/mocks/setupDevMocks.js')
    await api.post('/dev/seed', { players: DEV_PLAYERS, state: createInitialDevState(), force: true })
    message.value = 'Сброс выполнен'
  } catch {
    message.value = 'Ошибка запроса'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="mock-toolbar">
    <h2 class="mock-toolbar__title">Тестовые действия</h2>

    <div class="mock-toolbar__actions">
      <AppButton variant="ghost" :loading="loading" @click="addPair">
        Добавить случайную пару
      </AppButton>
      <AppButton variant="ghost" :loading="loading" @click="acceptInvite">
        Принять инвайт тестировщика
      </AppButton>
      <AppButton variant="ghost" :loading="loading" @click="receiveInvite">
        Получить случайный инвайт
      </AppButton>
      <AppButton variant="ghost" :loading="loading" @click="markPlayed">
        Я уже сыграл
      </AppButton>
      <AppButton variant="danger" :loading="loading" @click="reset">
        Сбросить моки
      </AppButton>
    </div>

    <p v-if="message" class="mock-toolbar__message">
      {{ message }}
    </p>
  </section>
</template>

<style lang="scss" scoped>
.mock-toolbar {
  padding: 12px;
  border: 1px dashed var(--color-hint);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;

  &__title {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-hint);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  &__actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  &__message {
    font-size: 13px;
    color: var(--color-hint);
  }
}

@media (max-width: 420px) {
  .mock-toolbar__actions {
    grid-template-columns: 1fr;
  }
}
</style>
