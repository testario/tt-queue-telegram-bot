<script setup>
import { onMounted } from 'vue'
import { useTelegram } from '@/composables/useTelegram.js'
import { useQueue } from '@/composables/useQueue.js'
import QueueView from '@/features/queue/QueueView.vue'
import AdminPanel from '@/features/admin/AdminPanel.vue'

const { ready, expand } = useTelegram()
const { init } = useQueue()

onMounted(async () => {
  expand()
  ready()
  await init()
})
</script>

<template>
  <div class="app">
    <QueueView />
    <AdminPanel />
  </div>
</template>

<style lang="scss">
:root {
  --color-bg: var(--tg-theme-bg-color, #ffffff);
  --color-text: var(--tg-theme-text-color, #000000);
  --color-hint: var(--tg-theme-hint-color, #999999);
  --color-link: var(--tg-theme-link-color, #2481cc);
  --color-button: var(--tg-theme-button-color, #2481cc);
  --color-button-text: var(--tg-theme-button-text-color, #ffffff);
  --color-secondary-bg: var(--tg-theme-secondary-bg-color, #f1f1f1);
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 16px;
}

.app {
  max-width: 480px;
  margin: 0 auto;
  padding: 0 16px 32px;
}
</style>
