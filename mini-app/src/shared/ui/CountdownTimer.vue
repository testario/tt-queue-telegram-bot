<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { formatCountdown } from '@/shared/lib/formatTime.js'

const props = defineProps({
  endDate: {
    type: Date,
    required: true,
  },
})

const remaining = ref('')
let timer = null

const tick = () => {
  const ms = props.endDate.getTime() - Date.now()
  remaining.value = formatCountdown(ms)
  if (ms <= 0) clearInterval(timer)
}

const startTimer = () => {
  clearInterval(timer)
  tick()
  timer = setInterval(tick, 1000)
}

onMounted(startTimer)
onUnmounted(() => clearInterval(timer))
watch(() => props.endDate, startTimer)
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
