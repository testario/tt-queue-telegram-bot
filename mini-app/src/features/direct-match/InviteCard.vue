<script setup>
import { computed, ref } from 'vue'
import { useQueue } from '@/composables/useQueue.js'
import { useTelegram } from '@/composables/useTelegram.js'
import { useApi } from '@/composables/useApi.js'
import AppButton from '@/shared/ui/AppButton.vue'

const { state } = useQueue()
const { player } = useTelegram()
const api = useApi()
const loading = ref(false)

// pendingInvites приходит в state из /api/events или /api/state
const myInvite = computed(() =>
  state.pendingInvites?.find((inv) => inv.opponent === player) ?? null
)

const accept = async () => {
  if (!myInvite.value) return
  loading.value = true
  try {
    await api.post('/direct/accept', { player: myInvite.value.player })
  } finally {
    loading.value = false
  }
}

const decline = async () => {
  if (!myInvite.value) return
  loading.value = true
  try {
    await api.post('/direct/decline', { player: myInvite.value.player })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div v-if="myInvite" class="invite-card">
    <p class="invite-card__text">
      {{ myInvite.player }} приглашает вас на игру
    </p>
    <div class="invite-card__actions">
      <AppButton :loading="loading" @click="accept">Принять</AppButton>
      <AppButton variant="ghost" :loading="loading" @click="decline">Отказаться</AppButton>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.invite-card {
  background: var(--color-secondary-bg);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;

  &__text {
    font-size: 16px;
    text-align: center;
  }

  &__actions {
    display: flex;
    gap: 8px;

    > * { flex: 1; }
  }
}
</style>
