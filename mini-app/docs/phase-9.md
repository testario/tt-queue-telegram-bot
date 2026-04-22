# Фаза 9: Разделение процессов (index-bot.js / index-backend.js)

**Статус:** В работе
**Начато:** 2026-04-22

## Журнал выполнения

### 9.2 src/index-bot.js

**Что сделано:** Создан entry point для bot-процесса. Требует `REDIS_URL`. Создаёт `RedisQueueRepository` и `RedisEventBus` (только publish). Вызывает `createBot` с этими зависимостями. После старта восстанавливает таймеры через `recoverTimers`. Подписывается на Redis Pub/Sub через `readBus` для получения `match_created` событий от backend-процесса — при получении вызывает `orchestrator.scheduleLifecycle(match)`.
**Файлы:** `src/index-bot.js`
**Решения:** Два отдельных объекта `RedisEventBus`: `eventBus` (publisher для исходящих событий бота) и `readBus` (subscriber для входящих событий от backend). Одно Redis-соединение нельзя использовать одновременно для PUBLISH и SUBSCRIBE — поэтому `createRedisPubSub` возвращает два клиента.

### 9.4 src/interfaces/webapp/index.js — поддержка backend-only режима

**Что сделано:** `createWebApp` рефакторирован для поддержки двух режимов работы. Добавлены два вспомогательных builder: `buildBackendContext` (строит контекст со всеми use-cases из `queueRepository` с null-orchestrator) и `buildLocalAdminState` (создаёт локальное in-memory состояние паузы/emerge и соответствующие функции). Когда передан `queueRepository`, всё необходимое строится внутри `createWebApp` — `getContext`, `messages`, `ui`, `isPauseModeEnabled`, `applyPauseMode` и т.д. Функция `buildStatePayload` вынесена на уровень `createWebApp` и используется как для EventNotifier (all-in-one), так и для Redis Pub/Sub (backend-only). Прежняя сигнатура и поведение all-in-one режима сохранены без изменений.
**Файлы:** `src/interfaces/webapp/index.js`
**Решения:** Null-orchestrator для backend-only режима — lifecycle-таймеры управляются bot-процессом, который слушает `match_created` через Redis. Pause/emerge-состояние в backend-only режиме хранится in-process (не синхронизируется с ботом) — известное ограничение MVP; для полной синхронизации потребуется Redis-хранилище паузы.

### 9.3 src/index-backend.js

**Что сделано:** Создан entry point для backend-процесса. Требует `REDIS_URL` и `TG_BOT_API_TOKEN`. Создаёт `RedisQueueRepository`, `RedisEventBus` (publisher + subscriber), `RedisInvitesStore`. Создаёт `TelegramApi` без polling — только для API-запросов (`getChatMember`, `sendMessage`, `getUserProfilePhotos`). Подключается к MongoDB для `MongoPlayersRepository` при наличии `PLAYERS_MONGODB_URI`. Вызывает `createWebApp` с `queueRepository` напрямую — контекст и admin-state строятся внутри `createWebApp`.
**Файлы:** `src/index-backend.js`
**Решения:** `eventBus` использует оба клиента (publisher + subscriber): publisher — для publish событий из backend (когда backend обрабатывает POST-запросы), subscriber — для получения событий от bot-процесса (SSE-рассылка). `TelegramApi` без polling: бот не слушает Telegram в backend-процессе, но может делать API-запросы.

### 9.6 package.json — скрипты start:bot и start:backend

**Что сделано:** Добавлены скрипты `start:bot` (запуск `node src/index-bot.js`) и `start:backend` (запуск `node src/index-backend.js`). Существующий `start` (all-in-one режим) сохранён без изменений.
**Файлы:** `package.json`

### Проверка тестов

**Что сделано:** `npm test` — 71 тест, 16 суитов, 0 ошибок. Изменение `createWebApp` обратно совместимо: all-in-one режим в `src/index.js` не передаёт `queueRepository`, поэтому backend-only ветка не активируется. Синтаксис новых файлов проверен через `node --check`.
**Файлы:** все тесты в `src/__tests__/`

## Итог

**Статус:** Частично завершена
**Выполнено критериев:** 0 из 7

**Невыполненные критерии (требуют запуска с Redis):**
- `node src/index-bot.js` — требует Redis и Telegram
- `node src/index-backend.js` — требует Redis
- Telegram → Redis → Pub/Sub → SSE — требует полного стека
- Mini App → Redis → бот → Telegram чат — требует полного стека
- POST /api/match → Redis → bot-таймеры — требует полного стека
- `node src/index.js` (all-in-one без Redis) — код обратно совместим; фактическая проверка требует запуска
- Паузы и emerge в split-режиме — реализованы in-process (известное ограничение), требуют запуска

**Архитектурные решения:**
- Null-orchestrator в backend-only режиме: lifecycle-таймеры ставит bot-процесс через Redis
- Pause/emerge в backend-only режиме: in-process состояние (не синхронизируется с ботом) — MVP-ограничение
- Backward compat all-in-one режима сохранена полностью

Код реализован полностью согласно плану. `npm test` — 71 тест, 0 ошибок.

**Следующая фаза:** phase-10-docker