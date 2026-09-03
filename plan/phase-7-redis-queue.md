# Этап 7: RedisQueueRepository

## Цель

Заменить `InMemoryQueueRepository` на `RedisQueueRepository` — персистентное хранилище
состояния очереди в Redis. Состояние переживает перезапуск процессов. `QueueState.from()`
уже умеет десериализоваться из JSON, поэтому переход минимально инвазивный.

## 7.1 Зависимости

Добавить в корневой `package.json`:

```json
"ioredis": "^5.0.0"
```

Почему `ioredis`, а не `redis` (официальный клиент):
- Зрелее, более широко используется
- Лучшая поддержка Pub/Sub (нужна в фазе 8)
- Стабильный API без breaking changes между версиями

## 7.2 RedisQueueRepository

```
src/infrastructure/repositories/
├── InMemoryQueueRepository.js   # существующий — не трогаем
└── RedisQueueRepository.js      # НОВЫЙ
```

```js
// src/infrastructure/repositories/RedisQueueRepository.js
import { QueueState } from '#domain/entities/QueueState.js'
import { createNullLogger } from '#infrastructure/logger/Logger.js'

const DEFAULT_KEY = 'queue:state'

/**
 * Хранит состояние очереди в Redis (JSON-сериализация).
 * @implements {import("#application/types.js").QueueRepository}
 */
class RedisQueueRepository {
  /**
   * @param {{ client: import('ioredis').Redis, key?: string, logger?: object }} deps
   */
  constructor({ client, key = DEFAULT_KEY, logger }) {
    this.client = client
    this.key = key
    this.log = logger || createNullLogger()
  }

  /**
   * Читает текущее состояние из Redis.
   * Если ключ не существует — возвращает пустое состояние.
   * @returns {Promise<QueueState>}
   */
  async get() {
    const raw = await this.client.get(this.key)
    if (!raw) return QueueState.createEmpty()
    try {
      return QueueState.from(JSON.parse(raw))
    } catch (err) {
      this.log.error('Ошибка десериализации состояния из Redis, возврат к пустому', {
        message: err.message,
      })
      return QueueState.createEmpty()
    }
  }

  /**
   * Сохраняет состояние очереди в Redis.
   * @param {QueueState} state
   * @returns {Promise<void>}
   */
  async save(state) {
    await this.client.set(this.key, JSON.stringify(state))
  }
}

export { RedisQueueRepository }
```

## 7.3 Создание Redis-клиента

```js
// src/infrastructure/redis/createRedisClient.js
import Redis from 'ioredis'
import { createNullLogger } from '#infrastructure/logger/Logger.js'

/**
 * Создаёт и подключает Redis-клиент.
 * @param {{ url: string, logger?: object }} deps
 * @returns {Promise<Redis>}
 */
export const createRedisClient = async ({ url, logger }) => {
  const log = logger || createNullLogger()
  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
  })
  await client.connect()
  log.info('Подключение к Redis установлено', { url })
  return client
}
```

## 7.4 Восстановление таймеров при рестарте бота

При перезапуске процесса in-memory таймеры `MatchOrchestrator` теряются.
Нужно переплановать их из состояния Redis при старте.

Возможные состояния матчей в очереди:
- `queue[0].status === 'playing'` → матч идёт, нужно переплановать только финиш
- `queue[0].status === 'waiting'` → матч ждёт старта, нужно переплановать старт+финиш
- `queue[1+]` — любой статус → эти матчи запустит оркестратор после завершения `queue[0]`

```js
// src/infrastructure/timers/recoverTimers.js

/**
 * Читает текущее состояние из репозитория и переплановывает таймеры
 * для матча, который должен был идти в момент рестарта.
 *
 * @param {{ repository, orchestrator, clock, logger }} deps
 */
export const recoverTimers = async ({ repository, orchestrator, clock, logger }) => {
  const log = logger || { info: () => {}, warn: () => {} }
  const state = await repository.get()

  if (!state.queue.length) {
    log.info('Восстановление таймеров: очередь пуста, восстанавливать нечего')
    return
  }

  const now = clock.now()
  const current = state.queue[0]

  if (current.endDate <= now) {
    // Матч уже должен был завершиться — завершаем сразу
    log.warn('Восстановление: матч просрочен, финишируем', {
      player1: current.player1,
      player2: current.player2,
      endDate: current.endDate,
    })
    await orchestrator.handleMatchFinished(current)
    return
  }

  if (current.status === 'playing') {
    log.info('Восстановление: матч в процессе, планируем только финиш', {
      player1: current.player1,
      player2: current.player2,
    })
    orchestrator.scheduleFinish(current)
  } else {
    log.info('Восстановление: матч ожидает старта, планируем полный lifecycle', {
      player1: current.player1,
      player2: current.player2,
    })
    orchestrator.scheduleLifecycle(current)
  }
}
```

## 7.5 Интеграция в src/index.js

Добавить выбор репозитория: Redis если задан `REDIS_URL`, иначе fallback на InMemory.

```js
// src/index.js
import { createRedisClient } from '#infrastructure/redis/createRedisClient.js'
import { RedisQueueRepository } from '#infrastructure/repositories/RedisQueueRepository.js'
import { recoverTimers } from '#infrastructure/timers/recoverTimers.js'

// После создания бота и перед createWebApp:

const redisUrl = process.env.REDIS_URL
let redisClient = null

if (redisUrl) {
  redisClient = await createRedisClient({ url: redisUrl, logger: log })
}

// Передаём клиент в createBot или меняем репозиторий после создания контекста
// Подробности — в документации createBot (нужно расширить для приёма внешнего репо)
```

**Проблема:** `createBot` сейчас создаёт репозиторий внутри себя. Нужно либо:
- Вынести создание репозитория наружу и передавать через deps (предпочтительно)
- Или принимать `queueRepository` как опциональный параметр

**Предпочтительный способ** — передать `queueRepository` в `createBot`:

```js
// В bot.js — добавить параметр:
const createBot = (token, { ..., queueRepository = null } = {}) => {
  // ...
  // Вместо: const repository = new InMemoryQueueRepository()
  const repository = queueRepository || new InMemoryQueueRepository()
  // ...
}
```

```js
// src/index.js
const queueRepository = redisClient
  ? new RedisQueueRepository({ client: redisClient, logger: log })
  : null  // createBot создаст InMemoryQueueRepository сам

const botResult = createBot(token, { metricsEnabled, playersRepository, queueRepository })

// После запуска — восстанавливаем таймеры
if (redisClient) {
  const ctx = botResult.getContext(botResult.queueChatId)
  await recoverTimers({
    repository: ctx.repository,
    orchestrator: ctx.orchestrator,
    clock: ctx.clock,
    logger: log,
  })
}
```

## 7.6 Переменные окружения

```env
# Redis
REDIS_URL=redis://localhost:6379
# Если не задан — используется InMemoryQueueRepository (backward compat)
```

## 7.7 Тесты

Тесты для `RedisQueueRepository` используют `ioredis-mock`:

```json
// package.json devDependencies
"ioredis-mock": "^8.0.0"
```

```js
// src/__tests__/redisQueueRepository.test.js
import { describe, it, expect, beforeEach } from '@jest/globals'
import RedisMock from 'ioredis-mock'
import { RedisQueueRepository } from '#infrastructure/repositories/RedisQueueRepository.js'
import { QueueState } from '#domain/entities/QueueState.js'

describe('RedisQueueRepository', () => {
  let client, repo

  beforeEach(() => {
    client = new RedisMock()
    repo = new RedisQueueRepository({ client })
  })

  it('возвращает пустое состояние если ключ не существует', async () => {
    const state = await repo.get()
    expect(state).toBeInstanceOf(QueueState)
    expect(state.queue).toHaveLength(0)
  })

  it('сохраняет и восстанавливает состояние', async () => {
    const state = QueueState.createEmpty()
    state.addSearching('@player1')
    await repo.save(state)
    const loaded = await repo.get()
    expect(loaded.searching).toContain('@player1')
  })

  it('восстанавливает даты матчей как Date объекты', async () => {
    const state = QueueState.createEmpty()
    const match = {
      player1: '@a', player2: '@b',
      startDate: new Date(), endDate: new Date(Date.now() + 60000),
      status: 'waiting',
    }
    state.enqueue(match)
    await repo.save(state)
    const loaded = await repo.get()
    expect(loaded.queue[0].startDate).toBeInstanceOf(Date)
    expect(loaded.queue[0].endDate).toBeInstanceOf(Date)
  })
})
```

## Критерии готовности этапа

- [x] `RedisQueueRepository.get()` возвращает `QueueState` из Redis, корректно десериализует даты
- [ ] `RedisQueueRepository.save()` персистирует состояние — после перезапуска состояние не теряется
- [ ] При отсутствии `REDIS_URL` приложение стартует с `InMemoryQueueRepository` без ошибок
- [ ] `recoverTimers` переплановывает таймеры при перезапуске для активного матча
- [ ] `recoverTimers` вызывает `handleMatchFinished` для просроченного матча
- [x] Тест `redisQueueRepository.test.js` проходит
- [x] `npm test` проходит полностью без регрессий
