<script setup>
import { computed, ref } from 'vue'
import { useQueue } from '@/composables/useQueue.js'
import { useTelegram } from '@/composables/useTelegram.js'
import { useApi } from '@/composables/useApi.js'
import AppButton from '@/shared/ui/AppButton.vue'
import AppIcon from '@/shared/ui/AppIcon.vue'

const { state } = useQueue()
const { player } = useTelegram()
const api = useApi()
const loading = ref(false)

// pendingInvites приходит в state из /api/events или /api/state
const myInvite = computed(() =>
  state.pendingInvites?.find((inv) => inv.opponent === player) ?? null
)

const inviteResolved = computed(() => {
  if (!myInvite.value) return false
  const inviter = myInvite.value.player
  if (state.played.includes(player) || state.played.includes(inviter)) return true
  return state.queue.some(
    (m) =>
      (m.player1 === inviter || m.player2 === inviter) &&
      (m.player1 === player || m.player2 === player)
  )
})

const accept = async () => {
  if (!myInvite.value) return
  loading.value = true
  try {
    await api.post('/direct/accept', { player: myInvite.value.player })
  } catch (error) {
    console.error('Не удалось принять приглашение', error)
  } finally {
    loading.value = false
  }
}

const decline = async () => {
  if (!myInvite.value) return
  loading.value = true
  try {
    await api.post('/direct/decline', { player: myInvite.value.player })
  } catch (error) {
    console.error('Не удалось отклонить приглашение', error)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div v-if="myInvite && !inviteResolved" class="invite-card">
    <div class="invite-card__header">
      <span class="invite-card__icon">
        <AppIcon name="mail" />
      </span>
      <div>
        <p class="invite-card__label">Входящий инвайт</p>
        <h2>{{ myInvite.player }} зовет на игру</h2>
      </div>
    </div>
    <div class="invite-card__actions">
      <AppButton :loading="loading" @click="accept">Принять</AppButton>
      <AppButton variant="ghost" :loading="loading" @click="decline">Отказаться</AppButton>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.invite-card {
  background: var(--color-surface);
  border-radius: 22px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: 0 8px 20px var(--color-card-shadow);

  &__header {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  &__icon {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 999px;
    background: var(--color-blue-soft);
    color: var(--color-link);
    flex: 0 0 auto;
  }

  &__label {
    color: var(--color-hint);
    font-size: 13px;
    font-weight: 800;
  }

  h2 {
    margin-top: 3px;
    color: var(--color-text);
    font-size: 17px;
    font-weight: 900;
  }

  &__actions {
    display: flex;
    gap: 10px;

    > * { flex: 1; }
  }
}
</style>
