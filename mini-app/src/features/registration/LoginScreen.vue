<script setup>
import { ref } from 'vue'
import { useApi, markPlayerVerified } from '@/composables/useApi.js'
import AppButton from '@/shared/ui/AppButton.vue'

const { post } = useApi()

const sending = ref(false)
const requestSent = ref(false)
const errorMessage = ref(null)

// Обычный переход в приложение делает не этот ответ, а player_verified из
// SSE (useQueue.js) — но если сервер уже знает, что игрок подтверждён
// (alreadyVerified: true — например, SSE-пуш потерялся при разрыве
// соединения, пока игрок был в чате, см. GET /api/events), снимаем экран
// сразу же, не дожидаясь следующего источника истины.
const requestConfirmation = async () => {
  if (sending.value) return
  sending.value = true
  errorMessage.value = null
  try {
    const result = await post('/register')
    if (result?.alreadyVerified) {
      markPlayerVerified()
      return
    }
    requestSent.value = true
  } catch (err) {
    errorMessage.value = err?.message === 'not_chat_member'
      ? 'Сначала вступи в общий чат, потом вернись сюда и попробуй снова.'
      : 'Не удалось отправить запрос. Проверь соединение и попробуй ещё раз.'
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <section class="login-screen" aria-live="polite">
    <span class="login-screen__icon" aria-hidden="true">👋</span>
    <h1 class="login-screen__eyebrow">Добро пожаловать</h1>
    <h3>Подтверди, что это ты</h3>
    <p class="login-screen__text">
      Чтобы пользоваться очередью в мини-аппе, подтверди доступ в общем чате — нажми кнопку ниже,
      бот пришлёт туда сообщение с кнопкой «Подтвердить», нажать её сможешь только ты.
    </p>

    <p v-if="requestSent" class="login-screen__status">
      Сообщение отправлено в чат — открой его и нажми «Подтвердить». Приложение обновится само.
    </p>
    <AppButton v-else :loading="sending" @click="requestConfirmation">
      Подтвердить в чате
    </AppButton>

    <p v-if="errorMessage" class="login-screen__error">{{ errorMessage }}</p>
    <AppButton v-if="requestSent" variant="ghost" :loading="sending" @click="requestConfirmation">
      Отправить ещё раз
    </AppButton>
  </section>
</template>

<style lang="scss" scoped>
.login-screen {
  min-height: min(68dvh, 520px);
  padding: 48px 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 12px;

  &__icon {
    width: 58px;
    height: 58px;
    display: grid;
    place-items: center;
    margin-bottom: 8px;
    border-radius: 20px;
    background: var(--color-blue-soft);
    font-size: 28px;
  }

  &__eyebrow {
    color: var(--color-link);
    font-size: 12px;
    font-weight: 850;
    text-transform: uppercase;
  }

  h1 { font-size: 25px; font-weight: 900; }

  &__text {
    max-width: 320px;
    margin-bottom: 8px;
    color: var(--color-text-secondary);
    font-size: 15px;
    line-height: 1.45;
  }

  &__status {
    max-width: 320px;
    color: var(--color-success);
    font-size: 14px;
    font-weight: 700;
    line-height: 1.4;
  }

  &__error {
    max-width: 320px;
    color: var(--color-danger);
    font-size: 14px;
  }
}
</style>
