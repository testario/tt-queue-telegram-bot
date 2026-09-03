# План разработки Telegram Mini App

## Обзор

Telegram Mini App для бота управления очередью настольного тенниса. Mini App дублирует
функциональность бота в графическом интерфейсе внутри Telegram.

## Архитектура

```
┌─────────────────────┐        ┌──────────────────────┐
│  Telegram чат       │        │  Telegram Mini App   │
│  (команды/кнопки)   │        │  (Vue 3 + Vite)      │
└────────┬────────────┘        └──────────┬───────────┘
         │ команды/callback               │ HTTP REST + SSE
         ▼                               ▼
┌────────────────────────────────────────────────────────┐
│  src/interfaces/                                       │
│  ├── telegram/bot.js   — Telegram Adapter              │
│  └── webapp/           — HTTP API (Fastify)            │
│      - auth (initData HMAC-SHA256)                     │
│      - routes → use-cases                              │
│      - SSE (EventNotifier → Mini App клиенты)          │
│      - chat notify (bot.sendMessage → Telegram чат)    │
└───────────────────────┬────────────────────────────────┘
                        │ оба интерфейса используют один контекст
                        ▼
┌────────────────────────────────────────────────────────┐
│  Application layer (единое состояние)                  │
│  RegisterSearch, AddMatch, CancelSearch, CancelMatch,  │
│  CreateDirectMatch, MatchOrchestrator, EventNotifier   │
└────────────────────────────────────────────────────────┘
```

**Принципы:**
- Бизнес-логика не дублируется — оба интерфейса вызывают одни и те же use-cases
- Состояние одно: `InMemoryQueueRepository` — единый источник правды для бота и Mini App
- Идентификация игрока через `Telegram.WebApp.initData` (HMAC-SHA256 верификация на сервере)
- Реал-тайм обновления через Server-Sent Events, подписка на существующий `EventNotifier`
- Фронтенд — отдельная директория `mini-app/`, собирается Vite, раздаётся как статика

## Синхронизация бот ↔ Mini App

Бот и Mini App работают **синхронно**: любое изменение состояния очереди немедленно
отражается в обеих средах. Реализуется через общий `EventNotifier` и два потока событий:

### Бот → Mini App

Когда пользователь выполняет команду в Telegram чате (или срабатывает таймер оркестратора):

1. Use-case / MatchOrchestrator изменяет `QueueState` в репозитории
2. `EventNotifier` публикует событие
3. Telegram-адаптер отправляет сообщение в чат (`bot.sendMessage`)
4. **SSE-менеджер** (подписан на тот же `EventNotifier`) рассылает `state_update` всем
   подключённым Mini App клиентам → Vue реактивно обновляет интерфейс

### Mini App → Telegram чат

Когда пользователь выполняет действие в Mini App (POST/DELETE к API):

1. Webapp-роутер вызывает тот же use-case
2. Use-case изменяет `QueueState` в общем репозитории
3. Webapp-роутер явно вызывает `bot.sendMessage(chatId, ...)` — уведомляет Telegram чат
   (для действий, которые оркестратор не покрывает автоматически)
4. SSE-менеджер рассылает `state_update` Mini App клиентам

### Какие действия требуют явного `bot.sendMessage` из webapp-роутера

| Действие в Mini App | Автоматическое уведомление в чат? | Нужен явный `bot.sendMessage`? |
|---------------------|-----------------------------------|-------------------------------|
| Встать в поиск | Нет | **Да** — `messages.searchAdded(player)` |
| Отменить поиск | Нет | **Да** — `messages.searchCancelled()` |
| Принять соперника (play_with) | Да — через MatchOrchestrator | Нет |
| Нет времени (cancelMatch) | Да — через MatchOrchestrator | Нет |
| Прямое приглашение | Нет | **Да** — `messages.directInvite(...)` с кнопками |
| Принять/отклонить приглашение | Нет | **Да** — `messages.directAccepted/Declined(...)` |
| Pause / Continue / Emerge | Нет | **Да** — соответствующие pause-сообщения |

### Таймеры оркестратора → Mini App

`MatchOrchestrator` ставит таймеры через `NodeTimer`. По истечении таймера:
- Срабатывает `handleMatchFinished` / `handleNextMatch`
- Оркестратор публикует событие через `EventNotifier`
- SSE-менеджер, подписанный на `EventNotifier`, получает событие и рассылает `state_update`

Это значит: когда матч автоматически завершается по таймеру — Mini App обновится
без каких-либо действий пользователя.

## Этапы

| # | Файл | Описание |
|---|------|----------|
| 1 | [phase-1-backend-api.md](./phase-1-backend-api.md) | HTTP API — новый webapp-интерфейс |
| 2 | [phase-2-vue-setup.md](./phase-2-vue-setup.md) | Инициализация Vue 3 проекта |
| 3 | [phase-3-queue-view.md](./phase-3-queue-view.md) | Отображение очереди (read-only) |
| 4 | [phase-4-player-actions.md](./phase-4-player-actions.md) | Действия игрока |
| 5 | [phase-5-admin-panel.md](./phase-5-admin-panel.md) | Панель администратора |
| 6 | [phase-6-deploy.md](./phase-6-deploy.md) | Деплой и регистрация Mini App |
| 7 | [phase-7-redis-queue.md](./phase-7-redis-queue.md) | RedisQueueRepository + восстановление таймеров |
| 8 | [phase-8-redis-pubsub.md](./phase-8-redis-pubsub.md) | Redis Pub/Sub — кросс-процессный EventBus |
| 9 | [phase-9-process-split.md](./phase-9-process-split.md) | Разделение на index-bot.js / index-backend.js |
| 10 | [phase-10-docker.md](./phase-10-docker.md) | Docker Compose — 5 сервисов (mongo, redis, bot, backend, frontend) |

## API endpoints (сводка)

| Method | Path | Действие |
|--------|------|----------|
| `GET`  | `/api/state` | Текущее состояние очереди |
| `GET`  | `/api/events` | SSE — поток событий в реальном времени |
| `POST` | `/api/search` | Встать в поиск соперника |
| `DELETE` | `/api/search` | Отменить поиск |
| `POST` | `/api/match` | Принять игрока в матч (play_with) |
| `DELETE` | `/api/match` | Отменить матч (нет времени) |
| `POST` | `/api/direct` | Прямое приглашение соперника |
| `POST` | `/api/direct/accept` | Принять прямое приглашение |
| `POST` | `/api/direct/decline` | Отклонить прямое приглашение |
| `POST` | `/api/direct/cancel` | Отменить своё прямое приглашение |
| `POST` | `/api/admin/pause` | Включить режим паузы (admin) |
| `POST` | `/api/admin/continue` | Снять режим паузы (admin) |
| `POST` | `/api/admin/emerge` | Экстренная пауза матча (admin) |

## Структура директорий (итоговая)

```
tt-queue-bot/
├── src/
│   └── interfaces/
│       ├── telegram/bot.js     # существующий
│       └── webapp/             # НОВЫЙ
│           ├── index.js
│           ├── auth.js
│           ├── sse.js
│           └── router.js
├── mini-app/                   # НОВЫЙ
│   ├── index.html
│   ├── vite.config.js
│   ├── package.json
│   └── src/
│       ├── app/
│       ├── features/
│       ├── composables/
│       └── shared/
└── plan/
    └── *.md
```

## Зависимости

**Backend** (добавить в корневой `package.json`):
- `fastify` — HTTP-сервер для webapp-интерфейса
- `@fastify/cors` — CORS-плагин
- `@fastify/static` — раздача статики

**Frontend** (отдельный `mini-app/package.json`):
- `vue` — фреймворк
- `vite`, `@vitejs/plugin-vue` — сборка
- `sass` — стили

Telegram WebApp SDK подключается через `<script>` тег из CDN Telegram — никакой npm-обёртки.