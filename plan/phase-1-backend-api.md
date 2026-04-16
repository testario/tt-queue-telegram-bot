# Этап 1: Backend HTTP API

## Цель

Создать новый интерфейс `src/interfaces/webapp/`, который предоставляет HTTP API для Mini App.
Интерфейс переиспользует существующие use-cases без изменения доменного слоя.

## Синхронизация: бот ↔ Mini App

Ключевое требование: любое изменение очереди — откуда бы оно ни пришло (Telegram-команда
или действие в Mini App) — должно немедленно отражаться **в обеих средах**:

- **Бот → Mini App**: EventNotifier (уже существует) публикует события →
  SSE-менеджер подписывается на него и рассылает `state_update` всем Mini App клиентам.
  Это покрывает и таймерные события оркестратора (матч начался, матч завершился).

- **Mini App → Telegram чат**: Webapp-роутер после вызова use-case явно вызывает
  `bot.sendMessage(chatId, ...)` для действий, которые оркестратор не покрывает
  автоматически (поиск, отмена поиска, прямые приглашения, пауза).

Оба интерфейса используют **один и тот же** экземпляр `InMemoryQueueRepository`
через `getContext(queueChatId)` — единый источник правды.

## 1.1 Зависимости

Добавить в корневой `package.json`:

```json
"fastify": "^5.0.0",
"@fastify/cors": "^10.0.0",
"@fastify/static": "^8.0.0"
```

**Почему Fastify, а не Express:**
- Встроенная сериализация JSON через схемы (быстрее, меньше кода)
- Нативная поддержка async/await без `express-async-errors`
- Встроенная валидация через JSON Schema
- TypeScript-friendly типы из коробки
- Активнее поддерживается (Express 4 не получает новых фич)

## 1.2 Структура файлов

```
src/interfaces/webapp/
├── index.js      — создаёт Fastify-приложение, подключает плагины, router
├── auth.js       — верификация Telegram initData через HMAC-SHA256
├── sse.js        — менеджер SSE-соединений, подписка на EventNotifier
└── router.js     — все REST-маршруты + bot.sendMessage для Telegram чата
```

## 1.3 auth.js — верификация initData

Telegram передаёт в Mini App строку `initData`. Перед каждым API-запросом клиент
отправляет её в заголовке `X-Telegram-Init-Data`. Сервер проверяет HMAC.

**Алгоритм проверки (по документации Telegram):**
1. Разбить строку `initData` на пары `key=value`, отсортировать по ключу
2. Исключить пару `hash=...`
3. Сформировать строку вида `key=value\nkey=value\n...`
4. Вычислить `HMAC-SHA256(data_check_string, secret_key)`, где `secret_key = HMAC-SHA256(bot_token, "WebAppData")`
5. Сравнить с `hash` из initData

**Данные пользователя из initData:**
```js
// После верификации прикрепляем к req:
req.tgUser = {
  id: user.id,
  username: user.username,      // используется как идентификатор игрока (@username)
  firstName: user.first_name,
  lastName: user.last_name,
}
req.player = `@${user.username}` // формат как в боте
```

**Важно:** Если у пользователя нет `username` — возвращаем `400`, аналогично
тому, как бот отвечает `messages.usernameRequired()`.

## 1.4 sse.js — Server-Sent Events

EventNotifier уже существует и публикует события через `onMessage`. SSE-менеджер
подписывается на него и транслирует события всем подключённым клиентам.

**Типы событий, которые нужно транслировать:**
- `state_update` — при любом изменении очереди (после каждого use-case)
- `match_created` — создан матч (payload: `{ player1, player2, startDate, endDate }`)
- `match_started` — матч начался
- `match_finished` — матч завершён

**Формат SSE-сообщения:**
```
event: state_update
data: {"queue":[...],"searching":[...],"played":[...],"paused":false}

```

**Реализация:**
```js
// sse.js
class SseManager {
  constructor() {
    this.clients = new Set()
  }

  addClient(res) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    this.clients.add(res)
    res.on('close', () => this.clients.delete(res))
  }

  broadcast(event, data) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    this.clients.forEach(res => res.write(message))
  }
}
```

**Подключение к EventNotifier — синхронизация бот → Mini App:**

EventNotifier уже используется ботом для отправки сообщений в Telegram чат.
Webapp-интерфейс подписывается на тот же экземпляр `notifier` из контекста чата.
Это гарантирует, что **любое событие** — команда бота, таймер оркестратора,
срабатывание по расписанию — немедленно обновит Mini App без опроса.

```js
// в index.js webapp-интерфейса, после получения context через getContext()
const context = getContext(queueChatId)

context.notifier.onMessage(async ({ chatId }) => {
  // Срабатывает при любом событии: matchCreated, matchStarted, matchFinished, etc.
  // Включая таймерные события MatchOrchestrator
  if (String(chatId) !== String(queueChatId)) return

  const payload = await buildStatePayload(context, queueChatId, { isPauseModeEnabled, emergeStateByChat })
  sseManager.broadcast('state_update', payload)
})
```

`buildStatePayload` — общая функция, используемая и в роутере, и здесь:
```js
const buildStatePayload = async (context, queueChatId, { isPauseModeEnabled, emergeStateByChat }) => {
  const state = await context.repository.get()
  return {
    queue: state.queue,
    searching: state.searching,
    played: state.played,
    paused: isPauseModeEnabled(queueChatId),
    emergeActive: emergeStateByChat.has(String(queueChatId)),
    serverTime: context.clock.now().toISOString(),
  }
}
```

## 1.5 router.js — маршруты

В Fastify маршруты регистрируются через `app.route()` или `app.get/post/delete()`.
Auth и requireAdmin — preHandler hooks.

```js
// src/interfaces/webapp/router.js
export const registerRoutes = async (app, deps) => {
  const { bot, getContext, queueChatId, sseManager, isPauseModeEnabled,
    setPauseMode, emergeStateByChat, applyPauseMode, resumeEmergeAfterContinue,
    resumeQueueAfterPause, handleEmerge } = deps

  const context = getContext(queueChatId)

  const buildStatePayload = async () => {
    const state = await context.repository.get()
    return {
      queue: state.queue,
      searching: state.searching,
      played: state.played,
      paused: isPauseModeEnabled(queueChatId),
      emergeActive: emergeStateByChat.has(String(queueChatId)),
      serverTime: context.clock.now().toISOString(),
    }
  }

  // --- Auth preHandler ---
  const auth = async (req, reply) => {
    const initData = req.headers['x-telegram-init-data']
    const result = verifyInitData(initData, process.env.TG_BOT_TOKEN)
    if (!result.ok) return reply.code(401).send({ error: result.reason })
    if (!result.user.username) return reply.code(400).send({ error: 'username_required' })
    req.tgUser = result.user
    req.player = `@${result.user.username}`
  }

  // --- requireAdmin preHandler ---
  const requireAdmin = async (req, reply) => {
    try {
      const member = await bot.getChatMember(queueChatId, req.tgUser.id)
      if (!['administrator', 'creator'].includes(member?.status)) {
        return reply.code(403).send({ error: 'admin_required' })
      }
    } catch {
      return reply.code(403).send({ error: 'admin_check_failed' })
    }
  }

  // ==================== ROUTES ====================

  // GET /api/state
  app.get('/api/state', async (req, reply) => {
    return buildStatePayload()
  })

  // GET /api/admin/check
  app.get('/api/admin/check', { preHandler: [auth] }, async (req, reply) => {
    try {
      const member = await bot.getChatMember(queueChatId, req.tgUser.id)
      return { isAdmin: ['administrator', 'creator'].includes(member?.status) }
    } catch {
      return { isAdmin: false }
    }
  })

  // GET /api/events — SSE
  app.get('/api/events', async (req, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.setHeader('X-Accel-Buffering', 'no')  // отключить буферизацию Nginx
    reply.hijack()

    sseManager.addClient(reply.raw)

    // Отправить текущее состояние сразу при подключении
    const payload = await buildStatePayload()
    reply.raw.write(`event: state_update\ndata: ${JSON.stringify(payload)}\n\n`)
  })

  // POST /api/search
  app.post('/api/search', { preHandler: [auth] }, async (req, reply) => {
    const result = await context.registerSearch.execute(req.player)
    sseManager.broadcast('state_update', await buildStatePayload())
    return { ok: true, status: result.status }
  })

  // DELETE /api/search
  app.delete('/api/search', { preHandler: [auth] }, async (req, reply) => {
    const result = await context.cancelSearch.execute(req.player)
    sseManager.broadcast('state_update', await buildStatePayload())
    return { ok: result.status === 'removed', status: result.status }
  })

  // POST /api/match — принять соперника (play_with)
  // opponent — тот, кто уже в поиске; req.player — нажавший кнопку
  app.post('/api/match', { preHandler: [auth] }, async (req, reply) => {
    const { opponent } = req.body
    const result = await context.addMatch.execute(opponent, req.player, {
      scheduleLifecycle: !isPauseModeEnabled(queueChatId),
    })
    if (result.ok) sseManager.broadcast('state_update', await buildStatePayload())
    return { ok: result.ok, reason: result.reason }
  })

  // DELETE /api/match — нет времени
  app.delete('/api/match', { preHandler: [auth] }, async (req, reply) => {
    const result = await context.cancelMatch.execute(req.player)
    if (result.ok) sseManager.broadcast('state_update', await buildStatePayload())
    return { ok: result.ok, status: result.status }
  })

  // POST /api/direct — прямое приглашение
  app.post('/api/direct', { preHandler: [auth] }, async (req, reply) => {
    const { opponent } = req.body
    const result = await context.directMatch.execute(req.player, opponent)
    if (result.ok) sseManager.broadcast('state_update', await buildStatePayload())
    return { ok: result.ok, reason: result.reason }
  })

  // POST /api/direct/accept
  app.post('/api/direct/accept', { preHandler: [auth] }, async (req, reply) => {
    const { player } = req.body
    const result = await context.addMatch.execute(player, req.player, {
      scheduleLifecycle: !isPauseModeEnabled(queueChatId),
    })
    if (result.ok) sseManager.broadcast('state_update', await buildStatePayload())
    return { ok: result.ok, reason: result.reason }
  })

  // POST /api/direct/decline
  app.post('/api/direct/decline', { preHandler: [auth] }, async (req, reply) => {
    const { player } = req.body
    await context.cancelSearch.execute(player)
    sseManager.broadcast('state_update', await buildStatePayload())
    return { ok: true }
  })

  // POST /api/direct/cancel
  app.post('/api/direct/cancel', { preHandler: [auth] }, async (req, reply) => {
    await context.cancelSearch.execute(req.player)
    sseManager.broadcast('state_update', await buildStatePayload())
    return { ok: true }
  })

  // POST /api/admin/pause
  app.post('/api/admin/pause', { preHandler: [auth, requireAdmin] }, async (req, reply) => {
    if (isPauseModeEnabled(queueChatId)) {
      return { ok: false, reason: 'already_paused' }
    }
    await applyPauseMode({ chatId: queueChatId, context, username: req.tgUser.username })
    sseManager.broadcast('state_update', await buildStatePayload())
    return { ok: true }
  })

  // POST /api/admin/continue
  app.post('/api/admin/continue', { preHandler: [auth, requireAdmin] }, async (req, reply) => {
    const emergeResult = await resumeEmergeAfterContinue({ chatId: queueChatId, context })
    const pauseEnabled = isPauseModeEnabled(queueChatId)

    if (!pauseEnabled && !emergeResult.handled) {
      return { ok: false, reason: 'not_paused' }
    }

    if (pauseEnabled) {
      setPauseMode(queueChatId, false)
      const resumeResult = await resumeQueueAfterPause(context)
      sseManager.broadcast('state_update', await buildStatePayload())
      return { ok: true, resumed: resumeResult }
    }

    sseManager.broadcast('state_update', await buildStatePayload())
    return { ok: true }
  })

  // POST /api/admin/emerge
  app.post('/api/admin/emerge', { preHandler: [auth, requireAdmin] }, async (req, reply) => {
    await handleEmerge({ chatId: queueChatId, context, userId: req.tgUser.id })
    sseManager.broadcast('state_update', await buildStatePayload())
    return { ok: true }
  })
}
```

**Ключевые особенности Fastify:**
- `preHandler: [auth]` — массив хуков выполняется последовательно, ошибка останавливает цепочку
- `reply.hijack()` — передаёт управление над raw socket для SSE (Fastify иначе пытается закрыть соединение)
- `return obj` вместо `res.json(obj)` — Fastify автоматически сериализует возвращаемое значение
- `reply.code(403).send(...)` — явная установка кода статуса

## 1.6 Уведомления в Telegram чат из webapp-роутера (Mini App → бот)

Действия, которые оркестратор не покрывает автоматически, требуют явного
`bot.sendMessage` — чтобы участники Telegram чата видели все изменения очереди
вне зависимости от того, где они сделаны: в боте или в Mini App.

```js
// Вспомогательная функция внутри registerRoutes
const notifyChat = (text, replyMarkup = undefined) =>
  bot.sendMessage(queueChatId, text, replyMarkup ? { reply_markup: replyMarkup } : undefined)
    .catch(err => log.error('Не удалось уведомить чат из webapp', { message: err.message }))
```

**Что уведомлять явно:**

| Маршрут | Условие | Сообщение в чат |
|---------|---------|-----------------|
| `POST /api/search` | `status === 'added'` | `messages.searchAdded(player)` + кнопки поиска |
| `DELETE /api/search` | `status === 'removed'` | `messages.searchCancelled()` |
| `POST /api/direct` | `ok === true` | `messages.directInvite(...)` + кнопки accept/decline/cancel |
| `POST /api/direct/accept` | `ok === true` | `messages.directAccepted(...)` |
| `POST /api/direct/decline` | всегда | `messages.directDeclined(...)` |
| `POST /api/direct/cancel` | всегда | `messages.directCancelled(...)` |
| `POST /api/admin/pause` | `ok === true` | `buildPauseModeEnabledMessage(freezeResult)` |
| `POST /api/admin/continue` | `ok === true` | `pauseModeDisabled / pauseModeDisabledCurrent / pauseModeDisabledNoQueue` |

**Что уведомлять НЕ нужно** (уже обрабатывается автоматически):
- `POST /api/match` → `AddMatch` → `MatchOrchestrator` → `EventNotifier` → `bot.sendMessage`
- `DELETE /api/match` → `CancelMatch` → `MatchOrchestrator` → `EventNotifier` → `bot.sendMessage`
- `POST /api/admin/emerge` → внутри `handleEmerge` уже есть `respondEmergeMessage`
- Таймерные события (матч начался/завершился) → `MatchOrchestrator` → `EventNotifier`

### Вынос клавиатур в общий модуль

`buildSearchInlineKeyboard` и `buildDirectInviteKeyboard` нужны и боту, и webapp-роутеру.
Чтобы не дублировать код, вынести их из `bot.js` в отдельный файл:

```
src/interfaces/telegram/
├── bot.js          # существующий — импортирует keyboards.js
└── keyboards.js    # НОВЫЙ — buildSearchInlineKeyboard, buildMatchCancelKeyboard,
                    #         buildDirectInviteKeyboard (accept/decline/cancel)
```

## 1.7 index.js — сборка интерфейса

```js
// src/interfaces/webapp/index.js
import Fastify from 'fastify'
import cors from '@fastify/cors'
import staticFiles from '@fastify/static'
import { fileURLToPath } from 'url'
import { resolve, dirname } from 'path'
import { registerRoutes } from './router.js'
import { SseManager } from './sse.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const createWebApp = async ({ bot, getContext, queueChatId, isPauseModeEnabled, log, ...deps }) => {
  const app = Fastify({ logger: false })

  // CORS для Telegram Mini App
  await app.register(cors, {
    origin: '*',
    allowedHeaders: ['Content-Type', 'X-Telegram-Init-Data'],
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  })

  // Раздача статики Mini App
  await app.register(staticFiles, {
    root: resolve(__dirname, '../../../mini-app/dist'),
    prefix: '/',
  })

  const sseManager = new SseManager()

  // Регистрация API-маршрутов
  await registerRoutes(app, {
    bot,
    getContext,
    queueChatId,
    sseManager,
    isPauseModeEnabled,
    log,
    ...deps,
  })

  const port = Number(process.env.WEBAPP_PORT) || 3000
  await app.listen({ port, host: '0.0.0.0' })
  log.info(`WebApp server listening on :${port}`)

  return { app, sseManager }
}
```

**Ключевые отличия от Express:**
- `app.register()` вместо `app.use()` — все плагины асинхронные
- `Fastify({ logger: false })` — логирование через существующий бот-логгер, не через встроенный pino
- `host: '0.0.0.0'` — обязательно для работы в Docker/VPS

## 1.8 Интеграция в src/index.js

Webapp-интерфейс запускается рядом с ботом, использует тот же контекст чата:

```js
// src/index.js — добавить после запуска бота
import { createWebApp } from '#interfaces/webapp/index.js'

const { bot, getContext } = createBot(token, options)

createWebApp({
  bot,
  getContext,
  queueChatId,
  isPauseModeEnabled,
  setPauseMode,
  emergeStateByChat,
  // ... остальные зависимости
})
```

## 1.9 Хранилище известных игроков (MongoDB)

Бот уже накапливает `playerDisplayNames` (`Map<string, string>`) в памяти. Нужно расширить
это до персистентного хранилища в MongoDB — чтобы список игроков сохранялся между
перезапусками и администратор мог управлять им вручную.

MongoDB уже используется в проекте для `UsageMetricsService` (коллекция `usage_metrics`),
поэтому подключение и клиент уже настроены — добавляем только новую коллекцию.

### Схема документа в коллекции `players`

```js
{
  _id: ObjectId,
  username: '@username',   // уникальный ключ, с @
  userId: 123456789,       // Telegram user_id (нужен для getUserProfilePhotos)
  displayName: 'Имя Фамилия',
  firstName: 'Имя',
  lastName: 'Фамилия',
  firstSeenAt: ISODate,    // когда впервые появился в системе
  lastSeenAt: ISODate,     // когда последний раз взаимодействовал с ботом
}
```

Уникальный индекс по `username`. Операция — `upsert` при каждом взаимодействии.

### PlayersRepository

```js
// src/infrastructure/players/MongoPlayersRepository.js

export class MongoPlayersRepository {
  constructor({ uri, dbName, collectionName = 'players', logger }) {
    this.uri = uri
    this.dbName = dbName
    this.collectionName = collectionName
    this.log = logger
    this.client = null
    this.collection = null
  }

  async connect() {
    const { MongoClient } = await import('mongodb')
    this.client = new MongoClient(this.uri)
    await this.client.connect()
    const db = this.client.db(this.dbName)
    this.collection = db.collection(this.collectionName)
    await this.collection.createIndex({ username: 1 }, { unique: true })
  }

  async upsert({ username, userId, firstName, lastName }) {
    if (!username) return
    const now = new Date()
    await this.collection.updateOne(
      { username },
      {
        $set: {
          userId,
          firstName: firstName ?? '',
          lastName: lastName ?? '',
          displayName: [firstName, lastName].filter(Boolean).join(' ') || username.replace('@', ''),
          lastSeenAt: now,
        },
        $setOnInsert: { firstSeenAt: now },
      },
      { upsert: true }
    )
  }

  async findAll() {
    return this.collection
      .find({}, { projection: { _id: 0, username: 1, displayName: 1, firstName: 1, lastName: 1, userId: 1 } })
      .sort({ lastSeenAt: -1 })
      .toArray()
  }

  async findOne(username) {
    return this.collection.findOne({ username }, { projection: { _id: 0 } })
  }

  async deleteOne(username) {
    const result = await this.collection.deleteOne({ username })
    return result.deletedCount > 0
  }
}
```

### Fallback: in-memory при отсутствии MongoDB

Если `MONGODB_URI` не задан — использовать легковесную in-memory реализацию
с тем же интерфейсом (`upsert`, `findAll`, `findOne`, `deleteOne`). Это сохраняет
возможность запуска без базы данных.

```js
// src/infrastructure/players/InMemoryPlayersRepository.js

export class InMemoryPlayersRepository {
  constructor() { this.players = new Map() }

  async upsert({ username, userId, firstName, lastName }) {
    if (!username) return
    this.players.set(username, {
      username, userId,
      firstName: firstName ?? '',
      lastName: lastName ?? '',
      displayName: [firstName, lastName].filter(Boolean).join(' ') || username.replace('@', ''),
      lastSeenAt: new Date(),
      firstSeenAt: this.players.get(username)?.firstSeenAt ?? new Date(),
    })
  }

  async findAll() { return Array.from(this.players.values()).sort((a, b) => b.lastSeenAt - a.lastSeenAt) }
  async findOne(username) { return this.players.get(username) ?? null }
  async deleteOne(username) { return this.players.delete(username) }
}
```

### Интеграция с ботом

В `src/interfaces/telegram/bot.js` функция `rememberUserDisplayName` уже вызывается
при каждой команде и callback. Добавить вызов `playersRepository.upsert(user)` рядом:

```js
// В createBot() — принять playersRepository как зависимость
const createBot = (token, { logger, locale, metricsEnabled, playersRepository } = {}) => {

  // Существующая функция — расширить:
  const rememberUserDisplayName = (user) => {
    if (user?.username) {
      playersRepository.upsert({          // ← новая строка
        username: `@${user.username}`,
        userId: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
      }).catch(() => {})                  // не роняем бота из-за ошибки записи
    }
    // ... существующий код без изменений
  }
}
```

### Endpoints

**`GET /api/players`** — список всех известных игроков (публичный):

```js
app.get('/api/players', async (req, reply) => {
  const players = await playersRepository.findAll()
  // userId не отдаём клиенту — нужен только серверу для avatar lookup
  return { players: players.map(({ userId, ...rest }) => rest) }
})
// Ответ: { players: [{ username, displayName, firstName, lastName, lastSeenAt }] }
```

**`GET /api/players/:username/avatar`** — аватар игрока (публичный):

```js
app.get('/api/players/:username/avatar', async (req, reply) => {
  const atUsername = `@${req.params.username}`
  const player = await playersRepository.findOne(atUsername)
  if (!player?.userId) return reply.code(404).send()

  try {
    const photos = await bot.getUserProfilePhotos(player.userId, { limit: 1 })
    if (!photos.total_count) return reply.code(404).send()

    // Берём самый маленький размер (индекс [0][0] — первое фото, наименьший вариант)
    const fileId = photos.photos[0][0].file_id
    const fileLink = await bot.getFileLink(fileId)

    // Редирект на Telegram CDN — не нагружаем наш сервер трафиком изображений
    return reply.redirect(302, fileLink)
  } catch (err) {
    log.warn('Не удалось получить аватар', { username: atUsername, message: err.message })
    return reply.code(404).send()
  }
})
```

**`DELETE /api/players/:username`** — удалить игрока из реестра (только admin):

```js
app.delete('/api/players/:username', { preHandler: [auth, requireAdmin] }, async (req, reply) => {
  const atUsername = `@${req.params.username}`
  const deleted = await playersRepository.deleteOne(atUsername)
  if (!deleted) return reply.code(404).send({ error: 'player_not_found' })
  return { ok: true }
})
```

**Почему редирект для аватара, а не проксирование:**
- Telegram CDN URL стабилен в рамках сессии токена
- Не нагружает сервер трафиком изображений
- `file_id` стабилен, `fileLink` может истечь — но при следующем запросе получим новый

## 1.10 Переменные окружения

Добавить в `.env`:
```
WEBAPP_PORT=3000
# MongoDB для players (можно переиспользовать уже существующие MONGODB_URI / MONGODB_DB)
PLAYERS_MONGODB_URI=...   # если не задан — используется InMemoryPlayersRepository
PLAYERS_MONGODB_DB=tt-queue-bot
PLAYERS_MONGODB_COLLECTION=players
```

## Критерии готовности этапа

**API и авторизация:**
- [ ] `GET /api/state` возвращает корректный JSON без авторизации (для отладки)
- [ ] `POST /api/search` с валидным `initData` добавляет игрока в поиск
- [ ] Невалидный `initData` возвращает `401`
- [ ] Отсутствие username возвращает `400`
- [ ] Запрос с правами не-администратора на `/api/admin/*` возвращает `403`

**Синхронизация бот → Mini App:**
- [ ] SSE-соединение получает `state_update` после команды `/search` в Telegram чате
- [ ] SSE-соединение получает `state_update` при срабатывании таймера оркестратора (матч начался/завершился)
- [ ] При подключении нового SSE-клиента он немедленно получает текущее состояние

**Синхронизация Mini App → Telegram чат:**
- [ ] `POST /api/search` (status=added) отправляет сообщение в Telegram чат с кнопками
- [ ] `DELETE /api/search` отправляет сообщение об отмене поиска в Telegram чат
- [ ] `POST /api/direct` отправляет сообщение с приглашением и кнопками в Telegram чат
- [ ] `POST /api/admin/pause` отправляет сообщение о паузе в Telegram чат

**Known players:**
- [ ] При каждой команде бота `playersRepository.upsert()` вызывается и сохраняет игрока
- [ ] `GET /api/players` возвращает список без поля `userId`
- [ ] `GET /api/players/:username/avatar` возвращает редирект на аватар или 404
- [ ] `DELETE /api/players/:username` доступен только администраторам и удаляет запись
- [ ] При отсутствии `PLAYERS_MONGODB_URI` используется `InMemoryPlayersRepository` без ошибок