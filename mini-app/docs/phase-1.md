# Фаза 1: Backend HTTP API

**Статус:** Завершена
**Начато:** 2026-04-19

## Журнал выполнения

### 1.1 Зависимости

**Что сделано:** Добавлены `fastify@^5.0.0`, `@fastify/cors@^10.0.0`, `@fastify/static@^8.0.0` в корневой `package.json`. Установлены через `npm install`.
**Файлы:** `package.json`
**Решения:** npm установил актуальные версии (fastify 5.8.5, cors 10.1.0, static 8.3.0) — совместимы с планом.

### 1.2 Структура файлов + keyboards.js

**Что сделано:** Создана директория `src/interfaces/webapp/`. Создан `src/interfaces/telegram/keyboards.js` с тремя экспортируемыми функциями: `buildSearchInlineKeyboard`, `buildMatchCancelKeyboard`, `buildDirectInviteKeyboard`. Функции принимают `ui` как параметр, чтобы их могли использовать и бот, и webapp-роутер.
**Файлы:** `src/interfaces/telegram/keyboards.js`
**Решения:** Функции вынесены из bot.js в отдельный файл без изменения логики. Принимают `ui` явно, чтобы не зависеть от замыкания createBot.

### 1.3 auth.js — верификация initData

**Что сделано:** Создан `src/interfaces/webapp/auth.js` с функцией `verifyInitData(initData, botToken)`. Реализует алгоритм HMAC-SHA256 верификации по документации Telegram. Возвращает `{ ok, user }` или `{ ok: false, reason }`.
**Файлы:** `src/interfaces/webapp/auth.js`
**Решения:** Использован встроенный модуль Node.js `crypto` — без внешних зависимостей. Все ошибки структурированы через `reason` для удобства отладки.

### 1.4 sse.js — Server-Sent Events

**Что сделано:** Создан `src/interfaces/webapp/sse.js` с классом `SseManager`. Хранит Set активных клиентов, добавляет SSE-заголовки при подключении, рассылает события всем клиентам через `broadcast(event, data)`. При ошибке записи клиент автоматически удаляется из Set.
**Файлы:** `src/interfaces/webapp/sse.js`
**Решения:** Добавлен try/catch в broadcast для защиты от ошибок записи в закрытые соединения (race condition между close-событием и broadcast).

### 1.5 + 1.6 router.js — маршруты и уведомления в Telegram чат

**Что сделано:** Создан `src/interfaces/webapp/router.js` со всеми REST-маршрутами. Реализованы: `GET /api/state`, `GET /api/events` (SSE), `GET/DELETE /api/players/*`, `POST/DELETE /api/search`, `POST/DELETE /api/match`, `POST /api/direct/*`, `POST /api/admin/*`. Добавлены Telegram-уведомления через `notifyChat` для действий, которые оркестратор не покрывает автоматически. `applyPauseMode` и `handleEmerge` отправляют сообщения в чат самостоятельно (через respondEmergeMessage).
**Файлы:** `src/interfaces/webapp/router.js`
**Решения:** `messages` и `ui` передаются как deps от createBot, чтобы использовать уже настроенную локализацию с display-именами. Для `/api/direct/cancel` тело запроса содержит `opponent` (нужен для формирования сообщения `directCancelled`).

### 1.7 index.js — сборка webapp-интерфейса

**Что сделано:** Создан `src/interfaces/webapp/index.js` с функцией `createWebApp`. Настраивает Fastify с CORS и раздачей статики. Подписывается на EventNotifier для трансляции state_update при событиях от бота/оркестратора. Если dist ещё не собран — логирует warn, но не падает.
**Файлы:** `src/interfaces/webapp/index.js`
**Решения:** Раздача статики обёрнута в try/catch: на этапе разработки dist может не существовать. Подписка на EventNotifier вынесена в index.js, а не в router.js — это точка сборки всего webapp-интерфейса.

### 1.9 PlayersRepository (MongoDB + InMemory)

**Что сделано:** Созданы `src/infrastructure/players/MongoPlayersRepository.js` и `src/infrastructure/players/InMemoryPlayersRepository.js`. Оба имеют одинаковый интерфейс: `upsert`, `findAll`, `findOne`, `deleteOne`. MongoPlayersRepository создаёт уникальный индекс по username при подключении.
**Файлы:** `src/infrastructure/players/MongoPlayersRepository.js`, `src/infrastructure/players/InMemoryPlayersRepository.js`
**Решения:** InMemoryPlayersRepository используется как fallback при отсутствии PLAYERS_MONGODB_URI — бот работает без MongoDB.

### 1.6 (bot.js) — Интеграция keyboards.js + playersRepository

**Что сделано:** В `bot.js` добавлен импорт из keyboards.js (с алиасами, чтобы не конфликтовать с локальными обёртками). Локальные функции `buildSearchInlineKeyboard` и `buildMatchCancelKeyboard` теперь обёртки вокруг импортированных. Принят `playersRepository` как опция: `rememberUserDisplayName` вызывает `playersRepository.upsert()` при каждом событии. `createBot` теперь возвращает расширенный объект с зависимостями для webapp.
**Файлы:** `src/interfaces/telegram/bot.js`

### 1.8 Интеграция в src/index.js

**Что сделано:** Переписан `src/index.js`: создаётся `playersRepository` (Mongo или InMemory в зависимости от env), передаётся в `createBot`. После создания бота все deps передаются в `createWebApp`.
**Файлы:** `src/index.js`
**Решения:** Использован top-level await для `playersRepository.connect()` — ES modules его поддерживают.

## Итог

**Статус:** Завершена
**Выполнено критериев:** 17 из 17
**Невыполненные критерии:** нет
**Следующая фаза:** phase-2-vue-setup