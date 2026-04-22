<script setup>
import { computed } from 'vue'
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

const startTime = computed(() => formatTime(props.match.startDate))
const endTime = computed(() => formatTime(props.match.endDate))
const isPlaying = computed(() => props.match.status === 'playing')
</script>

<template>
  <div :class="['match-card', { 'match-card--current': isCurrent, 'match-card--playing': isPlaying }]">

    <!-- Позиция в очереди -->
    <div v-if="position" class="match-card__position">#{{ position }}</div>

    <!-- Игроки -->
    <div class="match-card__players">
      <PlayerTag :name="match.player1" />
      <span class="match-card__vs">vs</span>
      <PlayerTag :name="match.player2" />
    </div>

    <!-- Таймер для текущего матча -->
    <div v-if="isCurrent && isPlaying" class="match-card__timer">
      <CountdownTimer :end-date="match.endDate" />
    </div>

    <!-- Время начала/окончания -->
    <div v-else class="match-card__time">
      {{ startTime }} — {{ endTime }}
    </div>

  </div>
</template>

<style lang="scss" scoped>
.match-card {
  background: var(--color-secondary-bg);
  border-radius: 12px;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;

  &--current {
    background: var(--color-button);
    color: var(--color-button-text);
  }

  &__players {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 16px;
    font-weight: 500;
  }

  &__vs {
    color: inherit;
    opacity: 0.6;
    font-size: 13px;
  }

  &__position {
    font-size: 12px;
    opacity: 0.6;
  }

  &__timer {
    font-size: 28px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    letter-spacing: 1px;
  }

  &__time {
    font-size: 14px;
    opacity: 0.7;
  }
}
</style>
