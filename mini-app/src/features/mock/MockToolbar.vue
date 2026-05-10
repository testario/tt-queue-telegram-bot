<script setup>
import { ref } from 'vue'
import AppButton from '@/shared/ui/AppButton.vue'

const message = ref(null)

const runAction = (action, successText) => {
  const mocks = window.__TT_QUEUE_MOCKS__

  if (!mocks?.[action]) {
    message.value = 'Моки не подключены'
    return
  }

  const result = mocks[action]()

  if (!result.ok) {
    message.value = 'Недостаточно игроков для действия'
    return
  }

  message.value = successText(result)
}

const createQueueMatch = () => {
  runAction(
    'createRandomQueueMatch',
    (result) => `В очередь добавлены ${result.player1} и ${result.player2}`
  )
}

const acceptTesterInvite = () => {
  runAction(
    'acceptTesterInviteByRandomUser',
    (result) => `${result.player} принял приглашение тестировщика`
  )
}

const receiveInvite = () => {
  runAction(
    'receiveRandomInvite',
    (result) => `${result.player} отправил приглашение тестировщику`
  )
}

const resetMocks = () => {
  const mocks = window.__TT_QUEUE_MOCKS__
  if (!mocks?.reset) return

  mocks.reset()
  message.value = 'Мок-состояние сброшено'
}
</script>

<template>
  <section class="mock-toolbar">
    <h2 class="mock-toolbar__title">Тестовые действия</h2>

    <div class="mock-toolbar__actions">
      <AppButton variant="ghost" @click="createQueueMatch">
        Добавить случайную пару
      </AppButton>
      <AppButton variant="ghost" @click="acceptTesterInvite">
        Принять инвайт тестировщика
      </AppButton>
      <AppButton variant="ghost" @click="receiveInvite">
        Получить случайный инвайт
      </AppButton>
      <AppButton variant="danger" @click="resetMocks">
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
  margin-top: 16px;
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
