# Этап 9: Разделение процессов (index-bot.js / index-backend.js)

## Цель

Разделить монолитный `src/index.js` на два независимых entry point:
- `src/index-bot.js` — только Telegram-бот + MatchOrchestrator (читает/пишет Redis)
- `src/index-backend.js` — только Fastify webapp (читает Redis, слушает Pub/Sub → SSE)

`src/index.js` сохраняется как режим all-in-one для локальной разработки.

## 9.1 Различия между процессами

| Компонент | Bot-процесс | Backend-процесс |
|-----------|-------------|-----------------|
| Telegram API (node-telegram-bot-api) | Да | Нет |
| MatchOrchestrator + NodeTimer | Да | Нет |
| EventNotifier (публикует в Redis) | Да | Нет |
| Fastify HTTP сервер | Нет | Да |
| SSE Manager | Нет | Да |
| Redis subscriber (слушает события) | Нет | Да |
| RedisQueueRepository | Да | Да |
| MongoPlayersRepository | Нет | Да |
| Timer recovery при старте | Да | Нет |

## 9.2 src/index-bot.js

```js
// src/index-bot.js
import 'dotenv/config'
import { createBot } from '#interfaces/telegram/bot.js'
import { parseCliOptions } from '#interfaces/cli/options.js'
import { createRedisClient } from '#infrastructure/redis/createRedisClient.js'
import { createRedisPubSub } from '#infrastructure/redis/createRedisClient.js'
import { RedisQueueRepository } from '#infrastructure/repositories/RedisQueueRepository.js'
import { RedisEventBus } from '#infrastructure/events/RedisEventBus.js'
import { recoverTimers } from '#infrastructure/timers/recoverTimers.js'

const token = process.env.TG_BOT_API_TOKEN
const redisUrl = process.env.REDIS_URL

if (!token) throw new Error('TG_BOT_API_TOKEN не найден в окружении')
if (!redisUrl) throw new Error('REDIS_URL обязателен для bot-процесса')

const { metricsEnabled } = parseCliOptions(process.argv.slice(2))

// Redis: отдельный клиент для хранилища + publisher для Pub/Sub
const stateClient = await createRedisClient({ url: redisUrl })
const { publisher } = await createRedisPubSub({ url: redisUrl })

const queueRepository = new RedisQueueRepository({ client: stateClient })
const eventBus = new RedisEventBus({ publisher, subscriber: null })

const botResult = createBot(token, {
  metricsEnabled,
  playersRepository: null,   // боту не нужен — только запись через upsert
  queueRepository,
  eventBus,                  // EventNotifier будет публиковать в Redis
})

const { getContext, queueChatId, log } = botResult

// Восстановление таймеров после рестарта
const ctx = getContext(queueChatId)
await recoverTimers({
  repository: ctx.repository,
  orchestrator: ctx.orchestrator,
  clock: ctx.clock,
  logger: log,
})

log.info('Bot-процесс запущен', { chatId: queueChatId })
```

## 9.3 src/index-backend.js

```js
// src/index-backend.js
import 'dotenv/config'
import { createWebApp } from '#interfaces/webapp/index.js'
import { MongoPlayersRepository } from '#infrastructure/players/MongoPlayersRepository.js'
import { InMemoryPlayersRepository } from '#infrastructure/players/InMemoryPlayersRepository.js'
import { createRedisClient } from '#infrastructure/redis/createRedisClient.js'
import { createRedisPubSub } from '#infrastructure/redis/createRedisClient.js'
import { RedisQueueRepository } from '#infrastructure/repositories/RedisQueueRepository.js'
import { RedisEventBus } from '#infrastructure/events/RedisEventBus.js'
import { RedisInvitesStore } from '#infrastructure/invites/RedisInvitesStore.js'
import { createLogger } from '#infrastructure/logger/Logger.js'

const log = createLogger({ prefix: 'backend' })
const redisUrl = process.env.REDIS_URL

if (!redisUrl) throw new Error('REDIS_URL обязателен для backend-процесса')

// Redis: отдельный клиент для хранилища + subscriber для Pub/Sub
const stateClient = await createRedisClient({ url: redisUrl })
const { publisher, subscriber } = await createRedisPubSub({ url: redisUrl })

const queueRepository = new RedisQueueRepository({ client: stateClient })
const eventBus = new RedisEventBus({ publisher, subscriber })
const invitesStore = new RedisInvitesStore({ client: stateClient })

// MongoDB для списка игроков (нужен для /api/players и аватаров)
const playersMongoUri = process.env.PLAYERS_MONGODB_URI || process.env.MONGODB_URI || null
const playersRepository = playersMongoUri
  ? new MongoPlayersRepository({
      uri: playersMongoUri,
      dbName: process.env.PLAYERS_MONGODB_DB || 'tt-queue-bot',
      collectionName: process.env.PLAYERS_MONGODB_COLLECTION || 'players',
    })
  : new InMemoryPlayersRepository()

if (playersMongoUri && playersRepository.connect) {
  await playersRepository.connect()
}

// Backend не имеет инстанса бота Telegram —
// передаём null, /api/admin/check требует TG_BOT_API_TOKEN для getChatMember
// В index-backend.js бот нужен только для двух операций:
//   1. bot.getChatMember() — проверка прав администратора
//   2. bot.sendMessage() — уведомления в чат
// Решение: создать минимальный TelegramApi только для этих операций

import TelegramApi from 'node-telegram-bot-api'
const token = process.env.TG_BOT_API_TOKEN
if (!token) throw new Error('TG_BOT_API_TOKEN обязателен для backend-процесса')
const tgApi = new TelegramApi(token)  // без polling — только для API-запросов

await createWebApp({
  bot: tgApi,
  queueRepository,          // передаём репозиторий напрямую
  eventBus,                  // подписывается на Redis для SSE
  invitesStore,
  playersRepository,
  queueChatId: process.env.TG_CHAT_ID,
  log,
})

log.info('Backend-процесс запущен')
```

## 9.4 Изменения в createWebApp и registerRoutes

`createWebApp` сейчас принимает `getContext(queueChatId)` — функцию из `createBot`.
В backend-режиме `createBot` не вызывается, контекст нужно строить иначе.

**Решение:** передать в `createWebApp` уже готовый контекст (или его компоненты).

```js
// src/interfaces/webapp/index.js — добавить поддержку прямой передачи репозитория:

export const createWebApp = async ({
  bot,
  // Режим all-in-one: getContext + queueChatId
  getContext,
  queueChatId,
  // Режим backend-only: прямые зависимости
  queueRepository,        // если задан — используем напрямую
  eventBus,               // если задан — подписка на Redis вместо EventNotifier
  invitesStore,           // если задан — Redis, иначе InMemory
  // Общие зависимости
  isPauseModeEnabled,
  setPauseMode,
  emergeStateByChat,
  applyPauseMode,
  resumeEmergeAfterContinue,
  resumeQueueAfterPause,
  handleEmerge,
  messages,
  playersRepository,
  log,
}) => {
  // Если передан queueRepository напрямую — используем stub-контекст
  const context = queueRepository
    ? buildStubContext({ queueRepository })
    : getContext(queueChatId)

  // SSE: подписываемся на Redis (backend-режим) или на EventNotifier (all-in-one)
  if (eventBus) {
    await sseManager.subscribeToRedis(eventBus, buildStatePayload)
  } else if (getContext) {
    const ctx = getContext(queueChatId)
    ctx.notifier.onMessage(async ({ chatId }) => {
      if (String(chatId) !== String(queueChatId)) return
      sseManager.broadcast('state_update', await buildStatePayload())
    })
  }
  // ...
}
```

**`buildStubContext`** — минимальный контекст для backend без бота:

```js
// Внутри webapp/index.js:
const buildStubContext = ({ queueRepository }) => ({
  repository: queueRepository,
  // use-cases создаются на основе репозитория
  // в backend-режиме use-cases не нужны (только чтение state через repository)
  // Изменения состояния должны проходить через bot-процесс
  // Поэтому POST /api/search и другые мутирующие эндпоинты —
  // пишут в Redis напрямую через те же use-cases с тем же репозиторием
})
```

**Важно:** В backend-процессе use-cases (RegisterSearch, AddMatch и т.д.) тоже нужны
для обработки POST-запросов. Их можно создать напрямую с `queueRepository`:

```js
import { QueueService } from '#domain/services/QueueService.js'
import { SystemClock } from '#infrastructure/time/SystemClock.js'
import { RegisterSearch } from '#application/usecases/RegisterSearch.js'
// ... остальные use-cases

const queueService = new QueueService()
const clock = new SystemClock()

const context = {
  repository: queueRepository,
  queueService,
  clock,
  registerSearch: new RegisterSearch({ repository: queueRepository, queueService, clock }),
  addMatch: new AddMatch({ repository: queueRepository, queueService, clock }),
  // ... остальные use-cases
  // orchestrator: null — оркестратор только в bot-процессе
}
```

## 9.5 Проблема: оркестратор только в боте

В backend-процессе нет `MatchOrchestrator`. Это значит:
- `AddMatch.execute` в backend не может передать `scheduleLifecycle` оркестратору
- При вызове `POST /api/match` из Mini App — матч создаётся в Redis, но таймер не ставится

**Решение:** Таймеры ставит только bot-процесс, реагируя на событие из Redis.

```
Mini App → POST /api/match → backend
backend → AddMatch.execute() → Redis (state saved)
backend → EventBus.publish({ type: 'match_created', match })
Redis → bot-процесс получает событие
bot → orchestrator.scheduleLifecycle(match)
```

Для этого bot-процесс должен слушать Redis Pub/Sub не только на чтение,
но и реагировать на специфические типы событий:

```js
// В src/index-bot.js — добавить подписку:
const { subscriber: botSubscriber } = await createRedisPubSub({ url: redisUrl })
const readBus = new RedisEventBus({ publisher: null, subscriber: botSubscriber })

await readBus.subscribe(async (event) => {
  if (event.type === 'match_created' && event.match) {
    const ctx = getContext(queueChatId)
    const isPaused = isPauseModeEnabled(queueChatId)
    if (!isPaused) {
      ctx.orchestrator.scheduleLifecycle(event.match)
    }
  }
})
```

А `EventBus.publish` в backend вызывается из `AddMatch` use-case когда матч создан.

## 9.6 Обновление package.json

```json
"scripts": {
  "start": "node src/index.js",
  "start:bot": "node src/index-bot.js",
  "start:backend": "node src/index-backend.js",
  "build:webapp": "cd mini-app && npm run build",
  "deploy": "npm run build:webapp && pm2 restart tt-queue-bot"
}
```

## 9.7 Переменные окружения для каждого процесса

**Bot-процесс:**
```env
TG_BOT_API_TOKEN=...
TG_CHAT_ID=...
REDIS_URL=redis://redis:6379
```

**Backend-процесс:**
```env
TG_BOT_API_TOKEN=...         # для getChatMember (проверка admin)
TG_CHAT_ID=...               # для sendMessage
REDIS_URL=redis://redis:6379
WEBAPP_PORT=3000
PLAYERS_MONGODB_URI=mongodb://mongodb:27017
PLAYERS_MONGODB_DB=tt-queue-bot
```

## Критерии готовности этапа

- [ ] `node src/index-bot.js` запускается, бот отвечает в Telegram чате
- [ ] `node src/index-backend.js` запускается, `GET /api/state` возвращает данные из Redis
- [ ] Действие в Telegram (команда `/search`) → бот пишет в Redis → бэкенд получает через Pub/Sub → SSE-клиент обновляется
- [ ] Действие в Mini App (`POST /api/search`) → бэкенд пишет в Redis → бот получает событие → уведомляет в Telegram чат
- [ ] `POST /api/match` из Mini App → бэкенд создаёт матч в Redis → bot-процесс ставит таймеры
- [ ] `node src/index.js` (all-in-one) по-прежнему работает без Redis
- [ ] Паузы и emerge-состояния корректно работают в split-режиме
