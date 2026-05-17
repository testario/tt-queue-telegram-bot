<script setup>
import { computed, ref } from 'vue'
import { useApi } from '@/composables/useApi.js'
import { useQueue } from '@/composables/useQueue.js'
import { useTelegram } from '@/composables/useTelegram.js'
import AppButton from '@/shared/ui/AppButton.vue'
import AppIcon from '@/shared/ui/AppIcon.vue'
import InviteCard from '@/features/direct-match/InviteCard.vue'
import DirectMatchModal from '@/features/direct-match/DirectMatchModal.vue'

const { state } = useQueue()
const { player } = useTelegram()
const api = useApi()

const loading = ref(false)
const showDirectModal = ref(false)

const incomingInvite = computed(() =>
  state.pendingInvites?.find((invite) => invite.opponent === player) ?? null
)

const outgoingInvite = computed(() =>
  state.pendingInvites?.find((invite) => invite.player === player) ?? null
)

const hasInvites = computed(() => incomingInvite.value || outgoingInvite.value)

const cancelInvite = async () => {
  if (!outgoingInvite.value) return

  loading.value = true
  try {
    await api.post('/direct/cancel', { opponent: outgoingInvite.value.opponent })
  } catch (error) {
    console.error('Не удалось отменить приглашение', error)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="invitations-view">
    <section class="invitations-view__hero">
      <div>
        <p class="invitations-view__eyebrow">Инвайты</p>
        <h1>Быстрая пара</h1>
      </div>
      <div class="invitations-view__hero-icon">
        <AppIcon name="mail" />
      </div>
    </section>

    <InviteCard />

    <section v-if="outgoingInvite" class="invitations-view__card">
      <div class="invitations-view__card-header">
        <div>
          <p class="invitations-view__label">Ваш запрос</p>
          <h2>{{ outgoingInvite.opponent }}</h2>
        </div>
        <span class="invitations-view__status">Ожидание</span>
      </div>
      <AppButton variant="ghost" :loading="loading" @click="cancelInvite">
        Отменить запрос
      </AppButton>
    </section>

    <section v-if="!hasInvites" class="invitations-view__empty">
      <span class="invitations-view__empty-icon">
        <AppIcon name="check" />
      </span>
      <div>
        <h2>Когда инвайтов нет</h2>
        <p>Показываем спокойное состояние и быстрый переход к игрокам.</p>
      </div>
    </section>

    <AppButton variant="primary" @click="showDirectModal = true">
      Пригласить игрока
    </AppButton>

    <Transition name="app-modal" :duration="260">
      <DirectMatchModal v-if="showDirectModal" @close="showDirectModal = false" />
    </Transition>
  </div>
</template>

<style lang="scss" scoped>
.invitations-view {
  display: flex;
  flex-direction: column;
  gap: 14px;

  &__hero {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 18px;
    border-radius: 24px;
    background: #193047;
    color: #ffffff;
    box-shadow: 0 14px 26px #19304730;

    h1 {
      font-size: 22px;
      font-weight: 900;
      line-height: 1.05;
    }
  }

  &__eyebrow,
  &__label {
    color: var(--color-text-secondary);
    font-size: 13px;
    font-weight: 800;
  }

  &__hero &__eyebrow {
    margin-bottom: 3px;
    color: #ddf0ff;
  }

  &__hero-icon,
  &__empty-icon {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
  }

  &__hero-icon {
    width: 44px;
    height: 44px;
    border-radius: 999px;
    background: var(--color-button);

    svg {
      width: 20px;
      height: 20px;
    }
  }

  &__card,
  &__empty {
    border-radius: 22px;
    background: var(--color-surface);
    box-shadow: 0 8px 20px var(--color-card-shadow);
  }

  &__card {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
    border: 1px solid var(--color-border);
  }

  &__card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;

    h2 {
      margin-top: 3px;
      color: var(--color-text);
      font-size: 18px;
      font-weight: 900;
    }
  }

  &__status {
    padding: 7px 10px;
    border-radius: 999px;
    background: var(--color-blue-soft);
    color: var(--color-link);
    font-size: 12px;
    font-weight: 850;
  }

  &__empty {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px;
    background: var(--color-blue-soft);

    h2 {
      color: var(--color-link);
      font-size: 14px;
      font-weight: 900;
    }

    p {
      margin-top: 3px;
      color: var(--color-text-secondary);
      font-size: 12px;
      font-weight: 600;
      line-height: 1.35;
    }
  }

  &__empty-icon {
    width: 42px;
    height: 42px;
    border-radius: 999px;
    background: var(--color-empty-icon-bg);
    color: var(--color-link);
  }
}
</style>
