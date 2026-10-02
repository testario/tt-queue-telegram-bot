# TT Queue Bot

Бот управления очередью на настольный теннис (Telegram). Архитектура по DDD: domain → application → infrastructure → interfaces.

## Запуск
1. `npm install`
2. В `.env` задайте `TG_BOT_API_TOKEN`.
3. В `.env` задайте `TG_CHAT_ID` (id основного чата).
4. В `.env` задайте `TOURNAMENT_PLAYERS` — список участников турнира, например `@player1,@player2`. Создать матч можно только между двумя никами из этого списка.
5. `npm start`

### Метрики использования
- Обычный `npm start` запускает бота без метрик и без обращений к MongoDB.
- Для включения метрик запускайте `npm run start:metrics` или передавайте флаг `--metrics` (`-m`) вручную.
- Для режима метрик задайте `METRICS_MONGODB_URI` (и при необходимости `METRICS_MONGODB_DB`, `METRICS_MONGODB_COLLECTION`).
- Для запуска через `docker compose` можно не задавать URI вручную: контейнер соберёт его из `tt-queue-bot/.env.mongo.local` (`MONGO_INITDB_ROOT_USERNAME`, `MONGO_INITDB_ROOT_PASSWORD`, `MONGO_INITDB_DATABASE`, `MONGODB_HOST`, `MONGODB_PORT`, `MONGODB_AUTH_SOURCE`).
- Ограничьте чат для выдачи статистики: `METRICS_CHAT_ID` (числовой id).
- Команда `/metrics 24h` (или `/metrics 7d`, по умолчанию 24h) показывает сводку использования только в доверенном чате.

## Тесты
- Unit: `npm test` (Jest, покрыты доменный сервис и use-case создания матча).

## Пересоздание Docker-сервисов

Скрипты выполняются из любой директории и по умолчанию используют
`docker-compose.yml`:

```bash
./scripts/recreate-frontend.sh
./scripts/recreate-backend.sh
./scripts/recreate-bot.sh
./scripts/recreate-all.sh
./scripts/update.sh
```

`recreate-all.sh` останавливает bot и backend перед одновременным пересозданием,
чтобы они не работали с разными версиями состояния очереди. Redis, MongoDB и
xray при этом не перезапускаются. `update.sh` сначала делает `git pull --ff-only`,
затем вызывает этот же согласованный rollout.

Для dev-стенда используйте одноимённые скрипты из `scripts/dev/`:

```bash
./scripts/dev/recreate-frontend.sh
./scripts/dev/recreate-backend.sh
./scripts/dev/recreate-bot.sh
./scripts/dev/recreate-all.sh
./scripts/dev/update.sh
./scripts/dev/force-recreate.sh --yes
```

`force-recreate.sh` полностью пересоздаёт dev-контейнеры и сеть, включая Redis,
MongoDB и xray. Скрипт также удаляет dev-volumes — очередь, игроки и другие
данные dev-стенда будут очищены. Он требует явного `--yes` и не предназначен
для production.

## Mini App без Telegram
- Запуск браузерного mock-режима: `cd mini-app && npm run dev:mock`.
- Открыть: `http://127.0.0.1:5173/app/`.
- В этом режиме подменяются Telegram WebApp, `/api/*` и SSE-события. Backend, домен и бот не нужны.
- Сброс мок-состояния из консоли браузера: `window.__TT_QUEUE_MOCKS__.reset()`.

## Архитектура
- Краткое описание слоёв и потоков: `docs/architecture.md`.
- Сообщения и тексты: `src/application/messages/localization.js` + `src/application/messages/locales/*`.

## Локализация
- Язык задаётся через переменные окружения `BOT_LOCALE` (по умолчанию `ru`) и `BOT_FALLBACK_LOCALE`.
- Конфигурация: `src/application/config/i18n.js`.
- Базовые локали: `src/application/messages/locales/ru.js` и `src/application/messages/locales/en.js`. При отсутствии ключа используется fallback.

## Основные команды
- `/play @username` — отправляет приглашение указанному оппоненту; он может принять или отклонить через кнопки в сообщении.
- Inline query:
  - «Найти игрока» — ставит игрока в поиск.
  - «Проверить очередь» — выводит очередь матчей.
  - «Посмотреть тех, кто уже отыграл» — список сыгравших.
