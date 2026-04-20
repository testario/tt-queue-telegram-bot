<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { formatCountdown } from '@/shared/lib/formatTime.js'

const props = defineProps({
  endDate: {
    type: Date,
    required: true,
  },
})

const remaining = ref('')

const tick = () => {
  const ms = props.endDate.getTime() - Date.now()
  remaining.value = formatCountdown(ms)
}

let timer = null

onMounted(() => {
  tick()
  timer = setInterval(tick, 1000)
})

onUnmounted(() => {
  clearInterval(timer)
})
</script>

<template>
  <span class="countdown">{{ remaining }}</span>
</template>

<style lang="scss" scoped>
.countdown {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
</style>
