<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import CountdownTimer from '@/shared/ui/CountdownTimer.vue'
import PlayerTag from '@/shared/ui/PlayerTag.vue'
import { formatTime } from '@/shared/lib/formatTime.js'

const props = defineProps({
  match: {
    type: Object,  // { player1, player2, startDate, endDate, status }
    required: true,
  },
  isCurrent: {
    type: Boolean,
    default: false,
  },
  position: {
    type: Number,
    default: null,
  },
})

defineEmits(['select'])

const now = ref(Date.now())
let progressTimer = null

onMounted(() => { progressTimer = setInterval(() => { now.value = Date.now() }, 1000) })
onUnmounted(() => clearInterval(progressTimer))

const startTime = computed(() => formatTime(props.match.startDate))
const endTime = computed(() => formatTime(props.match.endDate))
const isPlaying = computed(() => props.match.status === 'playing')
const isMatchStarted = computed(() => now.value >= props.match.startDate.getTime())
const progressPercent = computed(() => {
  const start = props.match.startDate.getTime()
  const end = props.match.endDate.getTime()
  const duration = end - start

  if (duration <= 0) return 100

  const elapsed = now.value - start
  return Math.min(100, Math.max(0, (elapsed / duration) * 100))
})
</script>

<template>
  <div
    :class="['match-card', { 'match-card--current': isCurrent, 'match-card--playing': isPlaying }]"
    role="button"
    :aria-label="`Открыть информацию о матче ${match.player1} против ${match.player2}`"
    @click="$emit('select', match)"
  >

    <div v-if="isCurrent" class="match-card__top">
      <span>{{ isPlaying ? 'Играют сейчас' : 'Следующая пара' }}</span>
      <span v-if="isPlaying" class="match-card__live">live</span>
    </div>

    <div v-else-if="position" class="match-card__position">#{{ position }}</div>

    <div class="match-card__players">
      <PlayerTag :name="match.player1" />
      <span class="match-card__vs">vs</span>
      <PlayerTag :name="match.player2" />
    </div>

    <div v-if="isCurrent && isPlaying" class="match-card__timer">
      <CountdownTimer :end-date="match.endDate" />
    </div>

    <div v-else class="match-card__time">
      {{ startTime }} — {{ endTime }}
    </div>

    <div v-if="isCurrent && isPlaying && isMatchStarted" class="match-card__progress">
      <span :style="{ width: `${progressPercent}%` }"></span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.match-card {
  width: 100%;
  border: none;
  background: var(--color-surface);
  border-radius: var(--radius-card);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 8px 20px var(--color-card-shadow);
  cursor: pointer;

  &--current {
    background: var(--color-button);
    color: var(--color-button-text);
    border-radius: 24px;
    padding: 18px;
    box-shadow: 0 14px 26px color-mix(in srgb, var(--color-button), transparent 70%);
  }

  &__players {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    color: var(--color-link);
    font-size: 18px;
    font-weight: 800;
  }

  &__vs {
    color: var(--color-text-secondary);
    font-size: 15px;
    font-weight: 800;
  }

  &__position {
    width: fit-content;
    padding: 5px 9px;
    border-radius: 999px;
    background: var(--color-surface-soft);
    color: var(--color-text-secondary);
    font-size: 12px;
    font-weight: 800;
  }

  &__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    color: #ddf0ff;
    font-size: 13px;
    font-weight: 800;
  }

  &__live {
    padding: 5px 9px;
    border-radius: 999px;
    background: #ffffff22;
    color: #ffffff;
    font-size: 12px;
    text-transform: uppercase;
  }

  &__timer {
    color: #ffffff;
    font-size: 54px;
    font-weight: 800;
    line-height: 0.95;
    font-variant-numeric: tabular-nums;
  }

  &__time {
    color: var(--color-text-secondary);
    font-size: 15px;
    font-weight: 600;
  }

  &__progress {
    height: 8px;
    overflow: hidden;
    border-radius: 999px;
    background: #ffffff33;

    span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: #ffffff;
    }
  }

  &--current &__players {
    color: #ffffff;
  }

  &--current &__vs {
    color: #ddf0ff;
  }

  &--current :deep(.player-tag) {
    background: #ffffff;
    color: var(--color-button);
  }
}
</style>
