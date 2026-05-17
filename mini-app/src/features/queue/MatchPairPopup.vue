<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import AppButton from '@/shared/ui/AppButton.vue'
import AppModal from '@/shared/ui/AppModal.vue'
import PlayerAvatar from '@/shared/ui/PlayerAvatar.vue'
import { formatCountdown, formatTime } from '@/shared/lib/formatTime.js'

const props = defineProps({
  match: {
    type: Object,
    required: true,
  },
})

defineEmits(['close'])

const now = ref(Date.now())
let timer = null

const isPlaying = computed(() => props.match.status === 'playing')
const startTime = computed(() => formatTime(props.match.startDate))
const endTime = computed(() => formatTime(props.match.endDate))
const statusText = computed(() => (isPlaying.value ? 'live' : 'ожидает'))
const scheduleText = computed(() => `${startTime.value} - ${endTime.value}`)

const remainingText = computed(() => {
  const ms = props.match.endDate.getTime() - now.value
  return formatCountdown(ms)
})

const progressPercent = computed(() => {
  const start = props.match.startDate.getTime()
  const end = props.match.endDate.getTime()
  const duration = end - start

  if (duration <= 0) return 100

  const elapsed = now.value - start
  return Math.min(100, Math.max(0, (elapsed / duration) * 100))
})

const tick = () => { now.value = Date.now() }

const startTimer = () => {
  clearInterval(timer)
  tick()

  if (isPlaying.value) {
    timer = setInterval(tick, 1000)
  }
}

onMounted(startTimer)
onUnmounted(() => clearInterval(timer))
watch(() => props.match, startTimer)
</script>

<template>
  <AppModal aria-label="Информация о матче" content-class="match-popup" @close="$emit('close')" v-slot="{ close }">
    <header class="match-popup__header">
      <h2>Матч</h2>
      <span :class="['match-popup__status', { 'match-popup__status--live': isPlaying }]">
        {{ statusText }}
      </span>
    </header>

    <div class="match-popup__player">
      <PlayerAvatar :username="match.player1" :size="48" />
      <div class="match-popup__player-info">
        <span class="match-popup__player-label">Игрок 1</span>
        <span class="match-popup__player-name">{{ match.player1 }}</span>
      </div>
    </div>

    <div class="match-popup__vs">vs</div>

    <div class="match-popup__player">
      <PlayerAvatar :username="match.player2" :size="48" />
      <div class="match-popup__player-info">
        <span class="match-popup__player-label">Игрок 2</span>
        <span class="match-popup__player-name">{{ match.player2 }}</span>
      </div>
    </div>

    <div v-if="isPlaying" class="match-popup__progress-card">
      <div class="match-popup__progress-top">
        <span>До конца</span>
        <strong>{{ remainingText }}</strong>
      </div>
      <div class="match-popup__progress">
        <span :style="{ width: `${progressPercent}%` }"></span>
      </div>
    </div>

    <div v-else class="match-popup__schedule">
      <span>Временной интервал</span>
      <strong>{{ scheduleText }}</strong>
    </div>

    <AppButton variant="ghost" @click="close">
      Закрыть
    </AppButton>
  </AppModal>
</template>

<style lang="scss" scoped>
:deep(.match-popup) {
  gap: 16px;
}

.match-popup {
  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;

    h2 {
      font-size: 22px;
      font-weight: 900;
      color: var(--color-text);
    }
  }

  &__status {
    padding: 7px 10px;
    border-radius: 999px;
    background: var(--color-blue-soft);
    color: var(--color-link);
    font-size: 12px;
    font-weight: 850;
    text-transform: uppercase;

    &--live {
      background: var(--color-button);
      color: var(--color-button-text);
    }
  }

  &__player {
    min-height: 76px;
    padding: 14px;
    border-radius: 18px;
    background: var(--color-surface-soft);
    display: flex;
    align-items: center;
    gap: 12px;
  }

  &__player-info {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  &__player-label {
    color: var(--color-hint);
    font-size: 12px;
    font-weight: 800;
  }

  &__player-name {
    overflow: hidden;
    color: var(--color-text);
    font-size: 18px;
    font-weight: 900;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__vs {
    width: 40px;
    height: 40px;
    margin: -5px auto;
    border-radius: 999px;
    background: var(--color-button);
    color: var(--color-button-text);
    display: grid;
    place-items: center;
    font-size: 13px;
    font-weight: 900;
    text-transform: uppercase;
  }

  &__schedule,
  &__progress-card {
    padding: 14px;
    border-radius: 18px;
    background: var(--color-blue-soft);
    display: flex;
    flex-direction: column;
    gap: 8px;

    span {
      color: var(--color-text-secondary);
      font-size: 12px;
      font-weight: 800;
    }

    strong {
      color: var(--color-link);
      font-size: 22px;
      font-weight: 900;
      font-variant-numeric: tabular-nums;
    }
  }

  &__progress-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  &__progress {
    height: 8px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--color-surface);

    span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--color-button);
    }
  }
}
</style>
