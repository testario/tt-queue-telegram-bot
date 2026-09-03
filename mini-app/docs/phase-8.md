# Фаза 8: Redis Pub/Sub — кросс-процессный EventBus

**Статус:** В работе
**Начато:** 2026-04-21

## Журнал выполнения

### 8.2 RedisEventBus

**Что сделано:** Создан `RedisEventBus` с методами `publish()` и `subscribe()`. Использует два отдельных Redis-клиента (publisher и subscriber) — это обязательное требование Redis. Все обработчики хранятся в `Set`, подписка на канал выполняется один раз.
**Файлы:** `src/infrastructure/events/RedisEventBus.js`

### 8.3 EventNotifier — поддержка eventBus

**Что сделано:** Расширен конструктор `EventNotifier` — принимает `{ emitter, eventBus }` вместо позиционного параметра. При вызове `notify()` дополнительно публикует в `eventBus.publish()` если он задан. Ошибки Redis не роняют бота (`.catch`). Обратная совместимость сохранена — `new EventNotifier()` без аргументов работает как раньше.
**Файлы:** `src/infrastructure/notifier/EventNotifier.js`

### 8.4 InMemoryInvitesStore и RedisInvitesStore

**Что сделано:** Созданы два хранилища с одинаковым интерфейсом `set/delete/getAll`. `InMemoryInvitesStore` — Map в памяти (fallback без Redis). `RedisInvitesStore` — Redis Hash с ключом `queue:invites`.
**Файлы:** `src/infrastructure/invites/InMemoryInvitesStore.js`, `src/infrastructure/invites/RedisInvitesStore.js`

### 8.4 router.js — invitesStore вместо pendingInvites Map

**Что сделано:** В `registerRoutes` убран локальный `const pendingInvites = new Map()`. Добавлен параметр `invitesStore` из `deps`. Все операции `pendingInvites.set/delete/values()` заменены на `await invitesStore.set/delete/getAll()`. `buildStatePayload` теперь вызывает `await invitesStore.getAll()`.
**Файлы:** `src/interfaces/webapp/router.js`

### 8.5 SseManager.subscribeToRedis()

**Что сделано:** Добавлен метод `subscribeToRedis(eventBus, buildPayload)` в `SseManager`. При получении Redis-события вызывает `buildPayload()` и рассылает `state_update` всем SSE-клиентам. Предназначен для использования в режиме разделённых процессов (backend без бота).
**Файлы:** `src/interfaces/webapp/sse.js`

### 8.6 createRedisPubSub()

**Что сделано:** В `createRedisClient.js` добавлена функция `createRedisPubSub` — создаёт два отдельных Redis-клиента (publisher + subscriber) и подключает их параллельно. Два клиента обязательны: Redis не разрешает PUBLISH и SUBSCRIBE в одном соединении.
**Файлы:** `src/infrastructure/redis/createRedisClient.js`

### 8.7+8.8 Интеграция в index.js, bot.js, webapp/index.js

**Что сделано:**
- `src/index.js`: при наличии `REDIS_URL` создаются pub/sub клиенты → `RedisEventBus` → `RedisInvitesStore`. Без Redis — `InMemoryInvitesStore`. `eventBus` и `invitesStore` передаются в `createBot` и `createWebApp`.
- `bot.js`: `createBot` принимает `eventBus`; `EventNotifier` создаётся с `{ eventBus }` для чата очереди.
- `webapp/index.js`: `invitesStore` передаётся в `registerRoutes`; `onMessage` handler дополнен `pendingInvites: await invitesStore.getAll()`.
**Файлы:** `src/index.js`, `src/interfaces/telegram/bot.js`, `src/interfaces/webapp/index.js`
**Решения:** В all-in-one режиме SSE по-прежнему работает через EventEmitter (не Redis Pub/Sub) — это исключает двойной broadcast. `subscribeToRedis` предназначен для split-process сценария (фаза 9).

### Тесты

**Что сделано:** `npm test` — 71 тест, 16 суитов, 0 ошибок. Изменение конструктора `EventNotifier` обратно совместимо (оба теста используют `new EventNotifier()` без аргументов).
**Файлы:** все тесты в `src/__tests__/`

## Итог

**Статус:** Частично завершена
**Выполнено критериев:** 3 из 7

**Выполненные критерии:**
- [x] `RedisInvitesStore` и `InMemoryInvitesStore` имеют одинаковый интерфейс `set/delete/getAll`
- [x] При отсутствии `REDIS_URL` всё работает через `InMemoryInvitesStore` без ошибок
- [x] Pub/Sub-клиенты — два отдельных Redis-соединения (`createRedisPubSub` создаёт publisher + subscriber)

**Невыполненные критерии (требуют живого Redis):**
- `RedisEventBus.publish/subscribe` — требует запуска двух процессов с Redis
- `EventNotifier` публикует в Redis — требует реального Redis-соединения
- SSE получает обновления через Redis Pub/Sub — требует split-process конфигурации (фаза 9)
- `pendingInvites` из Redis Hash — требует запуска с `REDIS_URL`

Код реализован полностью. `npm test` — 71 тест, 0 ошибок.

**Следующая фаза:** phase-9-process-split
