# TT Queue Bot

Бот управления очередью на настольный теннис (Telegram). Архитектура по DDD: domain → application → infrastructure → interfaces.

## Запуск
1. `npm install`
2. В `.env` задайте `TG_BOT_API_TOKEN`.
3. В `.env` задайте `TG_CHAT_ID` (id основного чата).
4. `npm start`

### Метрики использования
- Обычный `npm start` запускает бота без метрик и без обращений к MongoDB.
- Для включения метрик запускайте `npm run start:metrics` или передавайте флаг `--metrics` (`-m`) вручную.
- Для режима метрик задайте `METRICS_MONGODB_URI` (и при необходимости `METRICS_MONGODB_DB`, `METRICS_MONGODB_COLLECTION`).
- Для запуска через `docker compose` можно не задавать URI вручную: контейнер соберёт его из `tt-queue-bot/.env.mongo.local` (`MONGO_INITDB_ROOT_USERNAME`, `MONGO_INITDB_ROOT_PASSWORD`, `MONGO_INITDB_DATABASE`, `MONGODB_HOST`, `MONGODB_PORT`, `MONGODB_AUTH_SOURCE`).
- Ограничьте чат для выдачи статистики: `METRICS_CHAT_ID` (числовой id).
- Команда `/metrics 24h` (или `/metrics 7d`, по умолчанию 24h) показывает сводку использования только в доверенном чате.

## Тесты
- Unit: `npm test` (Jest, покрыты доменный сервис и use-case создания матча).

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
