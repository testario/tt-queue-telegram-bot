# Фаза 7: RedisQueueRepository

**Статус:** В работе
**Начато:** 2026-04-20

## Журнал выполнения

### 7.1 Зависимости

**Что сделано:** В корневой `package.json` добавлен `ioredis@^5.0.0` в dependencies и `ioredis-mock@^8.0.0` в devDependencies.
**Файлы:** `package.json`
**Решения:** `ioredis-mock` — для unit-тестов без реального Redis.

### 7.2 RedisQueueRepository

**Что сделано:** Создан `RedisQueueRepository` с методами `get()` и `save()`. `get()` десериализует состояние через `QueueState.from()`, что автоматически конвертирует строки дат в `Date`-объекты. При повреждённых данных в Redis возвращает пустое состояние.
**Файлы:** `src/infrastructure/repositories/RedisQueueRepository.js`

### 7.3 createRedisClient.js

**Что сделано:** Создан helper для создания и подключения ioredis-клиента. Использует `lazyConnect: true` для явного вызова `connect()` с обработкой ошибок.
**Файлы:** `src/infrastructure/redis/createRedisClient.js`

### 7.4 recoverTimers.js

**Что сделано:** Создан `recoverTimers` — восстанавливает таймеры при рестарте. Три сценария: очередь пуста (ничего), матч просрочен (вызывает `handleMatchFinished`), матч в процессе (только `scheduleFinish`), матч ожидает старта (`scheduleLifecycle`).
**Файлы:** `src/infrastructure/timers/recoverTimers.js`

### 7.5 Интеграция в index.js и bot.js

**Что сделано:** `createBot` расширен параметром `queueRepository`. В `getContext` при создании контекста для `queueChatId` используется переданный репозиторий вместо `InMemoryQueueRepository`. В `index.js` добавлено создание Redis-клиента и `RedisQueueRepository` при наличии `REDIS_URL`, а также вызов `recoverTimers` после старта бота.
**Файлы:** `src/interfaces/telegram/bot.js`, `src/index.js`
**Решения:** Условие `String(chatId) === String(queueChatId)` — защита от type mismatch (number vs string), аналогично существующему коду в боте.

### 7.7 Тесты RedisQueueRepository

**Что сделано:** Создан тест-файл с 3 тестами: пустое состояние при отсутствии ключа, сохранение и восстановление состояния, десериализация дат как `Date`-объектов. Используется `ioredis-mock`.
**Файлы:** `src/__tests__/redisQueueRepository.test.js`

## Итог

**Статус:** Частично завершена
**Выполнено критериев:** 3 из 7
**Невыполненные критерии:**
- `save()` персистирует после перезапуска — требует реального Redis и перезапуска процесса
- `REDIS_URL` absent → InMemoryQueueRepository — требует запуска приложения
- `recoverTimers` для активного матча — требует запуска с Redis и реального матча
- `recoverTimers` для просроченного матча — требует запуска с Redis и просроченного матча

Все 4 невыполненных критерия требуют живого Redis и запуска бота — верификация при деплое (фаза 6/10).
Код реализован полностью согласно плану; `npm test` — 71 тест, 16 суитов, 0 ошибок.

**Следующая фаза:** phase-8-redis-pubsub
