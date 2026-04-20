# Фаза 2: Инициализация Vue 3 проекта

**Статус:** Частично завершена
**Начато:** 2026-04-19

## Журнал выполнения

### 2.1 Инициализация проекта

**Что сделано:** Создан `mini-app/package.json` с зависимостями `vue@^3.5`, `vite@^6.3`, `@vitejs/plugin-vue@^5.2`, `sass@^1.86`. Создана структура директорий `src/{app,composables,shared,features}`. `npm install` выполнен успешно.
**Файлы:** `mini-app/package.json`
**Решения:** Vite CLI не сработал (директория не пустая — уже есть `docs/`), поэтому `package.json` и структура созданы вручную с актуальными версиями пакетов.

### 2.3 index.html

**Что сделано:** Создан `mini-app/index.html` с подключением Telegram WebApp SDK через `<script>` CDN.
**Файлы:** `mini-app/index.html`

### 2.4 vite.config.js

**Что сделано:** Создан `mini-app/vite.config.js` с алиасом `@` → `src/` и proxy `/api` → `http://localhost:3000` для локальной разработки.
**Файлы:** `mini-app/vite.config.js`

### 2.5 composables/useTelegram.js

**Что сделано:** Создан singleton composable. Читает `window.Telegram.WebApp` и возвращает `user`, `initData`, `username`, `player` (`@username`), а также методы `ready()`, `close()`, `expand()`.
**Файлы:** `mini-app/src/composables/useTelegram.js`

### 2.6 composables/useApi.js

**Что сделано:** Создана fetch-обёртка. Автоматически добавляет заголовок `X-Telegram-Init-Data` из `useTelegram`. При не-OK ответе бросает Error с кодом из JSON-тела.
**Файлы:** `mini-app/src/composables/useApi.js`

### 2.7 composables/useQueue.js

**Что сделано:** Создан singleton composable с module-scope reactive state. `init()` загружает начальное состояние через GET `/state`, затем открывает SSE-соединение. SSE-ошибки логируются в `state.error`, браузер переподключается автоматически.
**Файлы:** `mini-app/src/composables/useQueue.js`

### 2.8 app/App.vue

**Что сделано:** Создан корневой компонент. В `onMounted` вызывает `expand()`, `ready()`, `init()`. Определяет CSS-переменные из Telegram-темы. Импортирует `QueueView` и `AdminPanel`.
**Файлы:** `mini-app/src/app/App.vue`, `mini-app/src/features/queue/QueueView.vue` (заглушка), `mini-app/src/features/admin/AdminPanel.vue` (заглушка)
**Решения:** Фич-компоненты из фаз 3–5 созданы как пустые заглушки, чтобы App.vue компилировался.

### 2.9 app/main.js

**Что сделано:** Создана точка входа Vue-приложения.
**Файлы:** `mini-app/src/app/main.js`

### 2.10 shared/ui/AppButton.vue

**Что сделано:** Создан унифицированный компонент кнопки с вариантами `primary`, `danger`, `ghost`. Поддерживает `disabled` и `loading` состояния.
**Файлы:** `mini-app/src/shared/ui/AppButton.vue`

### 2.11 composables/usePlayers.js

**Что сделано:** Создан singleton composable с ленивой загрузкой списка игроков. `load()` идемпотентен — повторные вызовы игнорируются если данные уже загружены. `avatarUrl(username)` генерирует URL к серверному endpoint аватара.
**Файлы:** `mini-app/src/composables/usePlayers.js`

### 2.12 shared/ui/PlayerAvatar.vue

**Что сделано:** Создан компонент аватара. При ошибке загрузки изображения (404 / сетевая ошибка) показывает плейсхолдер с инициалом. Размер задаётся через prop `size` (px).
**Файлы:** `mini-app/src/shared/ui/PlayerAvatar.vue`

### 2.13 shared/lib/formatTime.js + остальные shared-компоненты

**Что сделано:** Созданы `formatTime` и `formatCountdown`. Дополнительно: `PlayerTag.vue` (username-таблетка), `CountdownTimer.vue` (тикающий таймер с setInterval, очищается в onUnmounted), `useAdmin.js` (checkAdmin + pause/resume/emerge с обработкой ошибок).
**Файлы:** `mini-app/src/shared/lib/formatTime.js`, `mini-app/src/shared/ui/PlayerTag.vue`, `mini-app/src/shared/ui/CountdownTimer.vue`, `mini-app/src/composables/useAdmin.js`

## Итог

**Статус:** Частично завершена
**Выполнено критериев:** 1 из 8
**Невыполненные критерии:**
- `npm run dev` — требует живого браузера, проверяется вручную
- `useTelegram().player` — требует запуска внутри Telegram, не верифицируется статически
- `useQueue().state` — требует запущенного backend
- SSE без CORS-ошибок — требует запущенного backend
- Тема Telegram — требует запуска в Telegram
- `usePlayers().load()` — требует запущенного backend
- `PlayerAvatar` — требует запуска в браузере

Критерий `npm run build` выполнен и проверен (16 модулей, dist создан, 0 ошибок).
Остальные 7 критериев требуют запуска приложения в браузере/Telegram — верификация при деплое (фаза 6).

**Следующая фаза:** phase-3-queue-view