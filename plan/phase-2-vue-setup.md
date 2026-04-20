# Этап 2: Инициализация Vue 3 проекта

## Цель

Создать директорию `mini-app/` с Vite + Vue 3, подключить Telegram WebApp SDK,
настроить composables для работы с API и организовать структуру проекта.

## 2.1 Инициализация проекта

```bash
cd tt-queue-bot
npm create vite@latest mini-app -- --template vue
cd mini-app
npm install
npm install -D sass
```

`mini-app/package.json` содержит только фронтенд-зависимости — отдельно от корневого.

## 2.2 Структура директорий

```
mini-app/
├── index.html
├── vite.config.js
├── package.json
└── src/
    ├── app/
    │   ├── App.vue           # корневой компонент
    │   └── main.js           # точка входа, монтирование Vue
    ├── features/
    │   ├── queue/
    │   │   ├── QueueView.vue     # главный экран: очередь + поиск
    │   │   └── MatchCard.vue     # карточка матча с таймером
    │   ├── search/
    │   │   └── SearchPanel.vue   # кнопка "Ищу соперника" + список ищущих
    │   ├── played/
    │   │   └── PlayedView.vue    # список отыгравших
    │   ├── direct-match/
    │   │   ├── DirectMatchModal.vue  # форма: ввод @username соперника
    │   │   └── InviteCard.vue        # входящее приглашение (accept/decline)
    │   └── admin/
    │       └── AdminPanel.vue    # Pause / Continue / Emerge
    ├── composables/
    │   ├── useTelegram.js    # Telegram WebApp SDK: user, initData, theme
    │   ├── useApi.js         # fetch-обёртка с X-Telegram-Init-Data заголовком
    │   ├── useQueue.js       # состояние очереди + SSE-подписка (синглтон)
    │   └── useAdmin.js       # проверка прав + admin actions
    └── shared/
        ├── ui/
        │   ├── AppButton.vue     # кнопка с вариантами primary/danger/ghost
        │   ├── PlayerTag.vue     # @username в виде таблетки/бейджа
        │   └── CountdownTimer.vue # обратный таймер
        └── lib/
            └── formatTime.js    # форматирование дат/времени
```

## 2.3 index.html

Telegram WebApp SDK подключается через тег `<script>` — единственный способ,
рекомендованный Telegram. Npm-пакеты для SDK не используются.

```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TT Queue</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/app/main.js"></script>
</body>
</html>
```

## 2.4 vite.config.js

```js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',  // проксируем к backend во время разработки
    },
  },
})
```

## 2.5 composables/useTelegram.js

Singleton composable. Возвращает данные из `window.Telegram.WebApp`.

```js
// useTelegram.js
const tg = window.Telegram?.WebApp

export function useTelegram() {
  const user = tg?.initDataUnsafe?.user ?? null
  const initData = tg?.initData ?? ''
  const username = user?.username ?? null
  const player = username ? `@${username}` : null

  // Адаптация темы приложения под тему Telegram
  // CSS-переменные --tg-theme-* уже доступны глобально от SDK

  const ready = () => tg?.ready()
  const close = () => tg?.close()
  const expand = () => tg?.expand()

  return { user, initData, username, player, ready, close, expand }
}
```

**Вызвать `tg.ready()` в `App.vue` `onMounted`** — это сигнализирует Telegram,
что приложение загрузилось и можно скрыть лоадер.

## 2.6 composables/useApi.js

Обёртка над `fetch`. Автоматически добавляет `initData` в заголовок
и разбирает JSON-ответ.

```js
// useApi.js
import { useTelegram } from './useTelegram.js'

export function useApi() {
  const { initData } = useTelegram()

  const request = async (method, path, body = undefined) => {
    const headers = {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': initData,
    }
    const res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'unknown' }))
      throw new Error(error.error || `HTTP ${res.status}`)
    }

    return res.json()
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    del: (path, body) => request('DELETE', path, body),
  }
}
```

## 2.7 composables/useQueue.js

Синглтон-composable: одно состояние на всё приложение. SSE-соединение открывается
при первом вызове и держится всё время жизни приложения.

```js
// useQueue.js
import { reactive, readonly } from 'vue'
import { useApi } from './useApi.js'

const state = reactive({
  queue: [],       // матчи: [{ player1, player2, startDate, endDate, status }]
  searching: [],   // @username[]
  played: [],      // @username[]
  paused: false,
  emergeActive: false,
  serverTime: null,
  loading: true,
  error: null,
})

let eventSource = null

const applyState = (data) => {
  state.queue = (data.queue || []).map(m => ({
    ...m,
    startDate: new Date(m.startDate),
    endDate: new Date(m.endDate),
  }))
  state.searching = data.searching || []
  state.played = data.played || []
  state.paused = data.paused || false
  state.emergeActive = data.emergeActive || false
  state.serverTime = data.serverTime ? new Date(data.serverTime) : null
}

const connectSse = () => {
  if (eventSource) return
  eventSource = new EventSource('/api/events')

  eventSource.addEventListener('state_update', (e) => {
    applyState(JSON.parse(e.data))
    state.loading = false
  })

  eventSource.onerror = () => {
    state.error = 'connection_lost'
    // Браузер автоматически переподключается через ~3сек — ничего делать не надо
  }

  eventSource.onopen = () => {
    state.error = null
  }
}

export function useQueue() {
  const { get } = useApi()

  const init = async () => {
    try {
      const data = await get('/state')
      applyState(data)
    } catch (e) {
      state.error = 'load_failed'
    } finally {
      state.loading = false
      connectSse()
    }
  }

  return { state: readonly(state), init }
}
```

**Почему singleton:** очередь — глобальное состояние, которое нужно всем компонентам.
Store на уровне module-scope проще и достаточно для этого проекта.

## 2.8 app/App.vue

```vue
<script setup>
import { onMounted } from 'vue'
import { useTelegram } from '@/composables/useTelegram.js'
import { useQueue } from '@/composables/useQueue.js'
import QueueView from '@/features/queue/QueueView.vue'
import AdminPanel from '@/features/admin/AdminPanel.vue'

const { ready, expand } = useTelegram()
const { init } = useQueue()

onMounted(async () => {
  expand()  // растянуть Mini App на весь экран
  ready()   // сигнал Telegram, что приложение готово
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
  // Telegram CSS-переменные автоматически устанавливаются SDK
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
```

## 2.9 app/main.js

```js
import { createApp } from 'vue'
import App from './App.vue'

createApp(App).mount('#app')
```

## 2.10 shared/ui/AppButton.vue

Единственная кнопка-компонент для всего приложения. Варианты стиля через prop.

```vue
<script setup>
defineProps({
  variant: {
    type: String,
    default: 'primary',
    // 'primary' | 'danger' | 'ghost'
  },
  disabled: Boolean,
  loading: Boolean,
})
</script>

<template>
  <button
    :class="['btn', `btn--${variant}`, { 'btn--loading': loading }]"
    :disabled="disabled || loading"
  >
    <slot />
  </button>
</template>

<style lang="scss" scoped>
.btn {
  width: 100%;
  padding: 12px 16px;
  border: none;
  border-radius: 10px;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.15s;

  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &--loading { opacity: 0.7; }

  &--primary {
    background: var(--color-button);
    color: var(--color-button-text);
  }

  &--danger {
    background: #ff3b30;
    color: #ffffff;
  }

  &--ghost {
    background: var(--color-secondary-bg);
    color: var(--color-text);
  }
}
</style>
```

## 2.11 composables/usePlayers.js

Singleton composable для загрузки и кеширования списка известных игроков.
Используется в DirectMatchModal как источник данных для пикера.

```js
// usePlayers.js
import { reactive, readonly } from 'vue'
import { useApi } from './useApi.js'

const state = reactive({
  players: [],   // [{ username, displayName, firstName, lastName }]
  loading: false,
  loaded: false,
})

export function usePlayers() {
  const { get } = useApi()

  const load = async () => {
    if (state.loaded || state.loading) return
    state.loading = true
    try {
      const data = await get('/players')
      state.players = data.players ?? []
      state.loaded = true
    } finally {
      state.loading = false
    }
  }

  // URL аватара для конкретного игрока — ссылка на серверный endpoint
  // Браузер сам обработает редирект на Telegram CDN
  const avatarUrl = (username) =>
    `/api/players/${username.replace('@', '')}/avatar`

  return { state: readonly(state), load, avatarUrl }
}
```

**Почему не грузим при старте приложения:** список нужен только когда пользователь
открывает DirectMatchModal. Ленивая загрузка уменьшает время первой отрисовки.

## 2.12 shared/ui/PlayerAvatar.vue

Компонент аватара игрока. Запрашивает изображение по `/api/players/:username/avatar`.
При 404 (нет аватара) или ошибке сети — показывает плейсхолдер с инициалами.

```vue
<script setup>
import { ref, computed } from 'vue'
import { usePlayers } from '@/composables/usePlayers.js'

const props = defineProps({
  username: {
    type: String,   // '@username'
    required: true,
  },
  size: {
    type: Number,
    default: 40,    // px
  },
})

const { avatarUrl } = usePlayers()
const failed = ref(false)

const src = computed(() => avatarUrl(props.username))

// Инициалы для плейсхолдера: первый символ username без @
const initials = computed(() =>
  props.username.replace('@', '').slice(0, 1).toUpperCase()
)

const onError = () => { failed.value = true }
</script>

<template>
  <div
    class="avatar"
    :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.floor(size * 0.4)}px` }"
  >
    <img
      v-if="!failed"
      :src="src"
      :alt="username"
      class="avatar__img"
      @error="onError"
    />
    <span v-else class="avatar__placeholder">{{ initials }}</span>
  </div>
</template>

<style lang="scss" scoped>
.avatar {
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  background: var(--color-secondary-bg);
  display: flex;
  align-items: center;
  justify-content: center;

  &__img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  &__placeholder {
    font-weight: 600;
    color: var(--color-hint);
    line-height: 1;
    user-select: none;
  }
}
</style>
```

**Поведение при ошибке:**
- `@error` на `<img>` срабатывает при 404 и при ошибке сети
- `failed = true` переключает на инициал — без повторных запросов
- Повторная загрузка произойдёт только при следующем монтировании компонента

## 2.13 shared/lib/formatTime.js

```js
// Форматирует Date в HH:MM
export const formatTime = (date) =>
  date instanceof Date
    ? date.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
    : '—'

// Форматирует оставшееся время в MM:SS
export const formatCountdown = (ms) => {
  if (ms <= 0) return '00:00'
  const totalSec = Math.floor(ms / 1000)
  const min = Math.floor(totalSec / 60).toString().padStart(2, '0')
  const sec = (totalSec % 60).toString().padStart(2, '0')
  return `${min}:${sec}`
}
```

## Критерии готовности этапа

- [ ] `npm run dev` в `mini-app/` открывает страницу без ошибок
- [ ] `useTelegram().player` возвращает `@username` при запуске в Telegram
- [ ] `useQueue().state` наполняется данными с `/api/state`
- [ ] SSE-соединение открывается и не падает с CORS-ошибкой
- [ ] Тема приложения соответствует теме Telegram (светлая/тёмная)
- [x] `npm run build` создаёт корректный `mini-app/dist/`
- [ ] `usePlayers().load()` загружает список игроков с `/api/players`
- [ ] `PlayerAvatar` показывает аватар при наличии и инициал при 404/ошибке
