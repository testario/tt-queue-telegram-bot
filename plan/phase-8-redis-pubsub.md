# Этап 8: Redis Pub/Sub — кросс-процессный EventBus

## Цель

Заменить in-process `EventNotifier` (EventEmitter) на `RedisEventBus`, основанный на
Redis Pub/Sub. Это позволит боту и бэкенду работать в разных процессах (Docker-сервисах)
и получать события друг от друга через Redis-канал.

Бот публикует события → Redis канал `queue:events` → бэкенд подписан → SSE-клиенты.

## 8.1 Архитектура событий

```
Bot-процесс                         Backend-процесс
──────────────────                  ──────────────────────────────
Use-case изменяет состояние         Redis subscriber слушает
    ↓                                    ↓
EventNotifier.notify()              RedisEventBus.onEvent()
    ↓                                    ↓
RedisEventBus.publish()             SseManager.broadcast()
    ↓                                    ↓
Redis PUBLISH queue:events ────────→ SSE → Vue клиент
```

Внутри одного процесса (режим all-in-one `src/index.js`): EventEmitter остаётся,
Redis bus добавляется поверх для SSE-уведомлений.

## 8.2 RedisEventBus

```
src/infrastructure/events/
└── RedisEventBus.js   # НОВЫЙ
```

```js
// src/infrastructure/events/RedisEventBus.js
import { createNullLogger } from '#infrastructure/logger/Logger.js'

const QUEUE_EVENTS_CHANNEL = 'queue:events'

/**
 * Кросс-процессный event bus на основе Redis Pub/Sub.
 *
 * Публикация: bot-процесс после каждого изменения состояния.
 * Подписка: backend-процесс для рассылки SSE-клиентам.
 */
class RedisEventBus {
  /**
   * @param {{ publisher: import('ioredis').Redis, subscriber: import('ioredis').Redis, logger?: object }} deps
   * Важно: publisher и subscriber — РАЗНЫЕ клиенты. Redis не позволяет
   * использовать один клиент и для PUBLISH, и для SUBSCRIBE одновременно.
   */
  constructor({ publisher, subscriber, logger }) {
    this.publisher = publisher
    this.subscriber = subscriber
    this.log = logger || createNullLogger()
    this._handlers = new Set()
  }

  /**
   * Публикует событие в Redis-канал (вызывается из bot-процесса).
   * @param {{ type: string, chatId: string|number, payload?: object }} event
   */
  async publish(event) {
    const message = JSON.stringify(event)
    await this.publisher.publish(QUEUE_EVENTS_CHANNEL, message)
    this.log.info('RedisEventBus: опубликовано событие', { type: event.type })
  }

  /**
   * Подписывается на события из Redis-канала (вызывается из backend-процесса).
   * @param {(event: object) => void} handler
   */
  async subscribe(handler) {
    this._handlers.add(handler)
    // Подписываемся один раз — все обработчики вызываем в цикле
    if (this._handlers.size === 1) {
      await this.subscriber.subscribe(QUEUE_EVENTS_CHANNEL)
      this.subscriber.on('message', (channel, message) => {
        if (channel !== QUEUE_EVENTS_CHANNEL) return
        try {
          const event = JSON.parse(message)
          this._handlers.forEach(h => h(event))
        } catch (err) {
          this.log.error('RedisEventBus: ошибка разбора события', { message: err.message })
        }
      })
    }
  }

  /**
   * Отписывается от Redis-канала.
   */
  async unsubscribe() {
    await this.subscriber.unsubscribe(QUEUE_EVENTS_CHANNEL)
    this._handlers.clear()
    this.log.info('RedisEventBus: отписан от канала')
  }
}

export { RedisEventBus }
```

## 8.3 Изменение EventNotifier — публикация в Redis

Текущий `EventNotifier` — EventEmitter. Расширяем его: при вызове `notify()`
дополнительно публикуем в Redis, если передан `eventBus`.

```js
// src/infrastructure/notifier/EventNotifier.js — расширить конструктор:

class EventNotifier {
  constructor({ eventBus = null } = {}) {
    this.emitter = new EventEmitter()
    this.eventBus = eventBus  // null → только in-process
  }

  notify(chatId, text, meta = {}) {
    this.emitter.emit('message', { chatId, text, ...meta })

    // Публикуем в Redis если bus настроен (bot-процесс с Redis)
    if (this.eventBus) {
      this.eventBus.publish({
        type: meta.type || 'state_update',
        chatId: String(chatId),
        payload: meta,
      }).catch(err => {
        // Не роняем бота из-за ошибки Redis
        console.error('EventNotifier: ошибка публикации в Redis', err.message)
      })
    }
  }

  onMessage(handler) {
    this.emitter.on('message', handler)
  }
}
```

## 8.4 Pending-приглашения — перенос в Redis

Сейчас `pendingInvites` хранится в `Map` внутри `router.js`. При разделении на
два процесса бот и бэкенд не видят этот Map. Переносим в Redis Hash.

**Redis структура:**
- Ключ: `queue:invites`
- Поля: `@player` → JSON строка `{ player, opponent, createdAt }`

```js
// src/infrastructure/invites/RedisInvitesStore.js  — НОВЫЙ
export class RedisInvitesStore {
  constructor({ client, key = 'queue:invites' }) {
    this.client = client
    this.key = key
  }

  async set(player, invite) {
    await this.client.hset(this.key, player, JSON.stringify(invite))
  }

  async delete(player) {
    await this.client.hdel(this.key, player)
  }

  async getAll() {
    const raw = await this.client.hgetall(this.key)
    if (!raw) return []
    return Object.values(raw).map(v => JSON.parse(v))
  }
}
```

**Fallback (без Redis)** — `InMemoryInvitesStore` с тем же интерфейсом:

```js
// src/infrastructure/invites/InMemoryInvitesStore.js  — НОВЫЙ
export class InMemoryInvitesStore {
  constructor() { this._map = new Map() }
  async set(player, invite) { this._map.set(player, invite) }
  async delete(player) { this._map.delete(player) }
  async getAll() { return Array.from(this._map.values()) }
}
```

**Изменения в router.js:**
- Убрать `const pendingInvites = new Map()` 
- Принять `invitesStore` как зависимость в `registerRoutes(app, deps)`
- Вызывать `invitesStore.set/delete/getAll()` вместо Map-операций

```js
// src/interfaces/webapp/router.js — изменить buildStatePayload:
const buildStatePayload = async () => {
  const state = await context.repository.get()
  return {
    queue: state.queue,
    searching: state.searching,
    played: state.played,
    paused: isPauseModeEnabled(queueChatId),
    emergeActive: emergeStateByChat.has(String(queueChatId)),
    pendingInvites: await invitesStore.getAll(),  // из Redis или InMemory
    serverTime: context.clock.now().toISOString(),
  }
}
```

## 8.5 Интеграция SSE → Redis Pub/Sub в backend-процессе

В режиме разделённых процессов бэкенд не имеет доступа к `EventNotifier` бота.
Вместо подписки на EventEmitter — подписываемся на Redis Pub/Sub.

```js
// src/interfaces/webapp/sse.js — добавить метод subscribeToRedis:

class SseManager {
  // ... существующий код ...

  /**
   * Подписывается на Redis Pub/Sub канал для получения событий из bot-процесса.
   * Используется когда бот и бэкенд — разные процессы.
   * @param {RedisEventBus} eventBus
   * @param {() => Promise<object>} buildPayload
   */
  async subscribeToRedis(eventBus, buildPayload) {
    await eventBus.subscribe(async (event) => {
      try {
        const payload = await buildPayload()
        this.broadcast('state_update', payload)
      } catch (err) {
        console.error('SseManager: ошибка при обработке Redis-события', err.message)
      }
    })
  }
}
```

## 8.6 Создание Redis-клиентов для Pub/Sub

Redis требует два отдельных соединения: одно для PUBLISH, одно для SUBSCRIBE.

```js
// src/infrastructure/redis/createRedisClient.js — расширить:

/**
 * Создаёт пару клиентов для Pub/Sub.
 * @param {{ url: string, logger?: object }} deps
 * @returns {Promise<{ publisher: Redis, subscriber: Redis }>}
 */
export const createRedisPubSub = async ({ url, logger }) => {
  const log = logger || createNullLogger()
  const publisher = new Redis(url, { lazyConnect: true })
  const subscriber = new Redis(url, { lazyConnect: true })
  await Promise.all([publisher.connect(), subscriber.connect()])
  log.info('Redis Pub/Sub клиенты подключены')
  return { publisher, subscriber }
}
```

## 8.7 Переменные окружения

Новых переменных не добавляется — используется тот же `REDIS_URL` из фазы 7.

```env
REDIS_URL=redis://localhost:6379
```

## 8.8 Режимы работы

| Режим | REDIS_URL | EventBus | InvitesStore |
|-------|-----------|----------|--------------|
| All-in-one (текущий) | Не задан | EventEmitter | InMemoryInvitesStore |
| All-in-one + Redis | Задан | EventEmitter + RedisEventBus | RedisInvitesStore |
| Bot-процесс | Задан | RedisEventBus (publish) | — |
| Backend-процесс | Задан | RedisEventBus (subscribe) | RedisInvitesStore |

## Критерии готовности этапа

- [ ] `RedisEventBus.publish()` и `subscribe()` работают: событие из одного процесса доходит до другого
- [ ] `EventNotifier` с `eventBus` публикует события в Redis после каждого `notify()`
- [ ] SSE-клиент получает `state_update` когда событие пришло через Redis Pub/Sub (не только in-process)
- [x] `RedisInvitesStore` и `InMemoryInvitesStore` имеют одинаковый интерфейс
- [ ] `pendingInvites` корректно отдаются в `/api/state` из Redis Hash
- [x] При отсутствии `REDIS_URL` всё работает как раньше через in-memory реализации
- [x] Pub/Sub-клиенты — два отдельных Redis-соединения (не одно)
