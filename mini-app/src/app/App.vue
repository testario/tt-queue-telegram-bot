<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useTelegram } from '@/composables/useTelegram.js'
import { useQueue } from '@/composables/useQueue.js'
import { useAdmin } from '@/composables/useAdmin.js'
import { useBanStatus } from '@/composables/useApi.js'
import { usePlayers } from '@/composables/usePlayers.js'
import QueueView from '@/features/queue/QueueView.vue'

import PlayersView from '@/features/players/PlayersView.vue'
import AdminPanel from '@/features/admin/AdminPanel.vue'
import MockToolbar from '@/features/mock/MockToolbar.vue'
import BottomNavigation from '@/shared/ui/BottomNavigation.vue'

const { ready, expand } = useTelegram()
const { init } = useQueue()
const { isAdmin, checkAdmin } = useAdmin()
const { load: loadPlayers } = usePlayers()
const banStatus = useBanStatus()
const activeTab = ref('queue')
const isMockMode =
  import.meta.env.DEV &&
  (import.meta.env.MODE === 'mock' || import.meta.env.VITE_USE_MOCKS === 'true')

const navigationTabs = computed(() => {
  const tabs = [
    { id: 'queue', label: 'Очередь', icon: 'trophy' },
    { id: 'players', label: 'Игроки', icon: 'users' },
  ]

  if (isAdmin.value === true) {
    tabs.push({ id: 'management', label: 'Управление', icon: 'settings' })
  }

  return tabs
})

const activeView = computed(() => ({
  queue: QueueView,
  players: PlayersView,
  management: AdminPanel,
}[activeTab.value] ?? QueueView))

watch(isAdmin, (value) => {
  if (value === false && activeTab.value === 'management') {
    activeTab.value = 'queue'
  }
})

onMounted(async () => {
  // Доступ только из Telegram WebApp; прямые переходы получают лендинг
  if (!isMockMode && !window.Telegram?.WebApp?.initData) {
    window.location.replace('/')
    return
  }
  expand()
  ready()
  await init()
  // Проверяем banned даже на стартовой вкладке очереди, где список игроков ещё не виден.
  await loadPlayers().catch((error) => {
    console.error('Не удалось загрузить список игроков', error)
  })
  await checkAdmin()
})
</script>

<template>
  <div class="app">
    <MockToolbar v-if="isMockMode" />
    <main class="app__content">
      <section v-if="banStatus.isBanned" class="blocked-state" aria-live="polite">
        <span class="blocked-state__icon" aria-hidden="true">!</span>
        <p class="blocked-state__eyebrow">Доступ ограничен</p>
        <h1>Вы заблокированы</h1>
        <p class="blocked-state__text">
          Функции очереди и приглашения недоступны. Если это ошибка, обратитесь к администратору.
        </p>
      </section>
      <component v-else :is="activeView" />
    </main>
    <div v-if="!banStatus.isBanned" class="app__nav">
      <BottomNavigation
        :active-tab="activeTab"
        :tabs="navigationTabs"
        @change="activeTab = $event"
      />
    </div>
  </div>
</template>

<style lang="scss">
:root {
  color-scheme: light;
  --color-bg: var(--tg-theme-bg-color, #f6f8fa);
  --color-text: var(--tg-theme-text-color, #15171a);
  --color-text-secondary: var(--tg-theme-subtitle-text-color, #5d6673);
  --color-hint: var(--tg-theme-hint-color, #9aa1aa);
  --color-muted: #9aa1aa;
  --color-link: var(--tg-theme-link-color, #2a86d1);
  --color-button: var(--tg-theme-button-color, #2a86d1);
  --color-button-hover: #1976c9;
  --color-button-text: var(--tg-theme-button-text-color, #ffffff);
  --color-secondary-bg: var(--tg-theme-secondary-bg-color, #eef1f4);
  --color-surface: #ffffff;
  --color-surface-soft: #eef1f4;
  --color-border: #e5e8ec;
  --color-danger: #ef4444;
  --color-success: #22a06b;
  --color-warning: #f59e0b;
  --color-blue-soft: #eaf4ff;
  --color-empty-icon-bg: #ddf0ff;
  --color-card-shadow: #13203314;
  --color-nav-shadow: #00000012;
  --radius-card: 20px;
  --radius-control: 16px;
}

@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --color-bg: var(--tg-theme-bg-color, #0b111a);
    --color-text: var(--tg-theme-text-color, #f6f8fa);
    --color-text-secondary: var(--tg-theme-subtitle-text-color, #a8b3c2);
    --color-hint: var(--tg-theme-hint-color, #7f8ea3);
    --color-muted: #7f8ea3;
    --color-link: var(--tg-theme-link-color, #3a9bee);
    --color-button: var(--tg-theme-button-color, #3a9bee);
    --color-button-hover: #5ab0ff;
    --color-secondary-bg: var(--tg-theme-secondary-bg-color, #202a38);
    --color-surface: #151c27;
    --color-surface-soft: #202a38;
    --color-border: #2d3848;
    --color-blue-soft: #14324e;
    --color-empty-icon-bg: #1c4264;
    --color-card-shadow: #00000033;
    --color-nav-shadow: #00000010;
  }
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 16px;
}

button,
input {
  font: inherit;
}

.app {
  width: min(100%, 430px);
  min-height: 100dvh;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  background: var(--color-bg);

  &__content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 12px 16px calc(132px + env(safe-area-inset-bottom, 0px));
  }

  &__nav {
    position: fixed;
    right: max(16px, calc((100vw - 430px) / 2 + 16px));
    bottom: calc(env(safe-area-inset-bottom, 0px) + 16px);
    left: max(16px, calc((100vw - 430px) / 2 + 16px));
    z-index: 20;
  }
}

.blocked-state {
  min-height: min(68dvh, 520px);
  padding: 48px 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;

  &__icon {
    width: 58px;
    height: 58px;
    display: grid;
    place-items: center;
    margin-bottom: 20px;
    border-radius: 20px;
    background: color-mix(in srgb, var(--color-danger), transparent 86%);
    color: var(--color-danger);
    font-size: 28px;
    font-weight: 900;
  }

  &__eyebrow {
    margin-bottom: 8px;
    color: var(--color-danger);
    font-size: 12px;
    font-weight: 850;
    letter-spacing: .08em;
    text-transform: uppercase;
  }

  h1 { font-size: 25px; font-weight: 900; }
  &__text {
    max-width: 310px;
    margin-top: 12px;
    color: var(--color-text-secondary);
    font-size: 15px;
    line-height: 1.45;
  }
}
</style>
