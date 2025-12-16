# TT Queue Bot

Бот управления очередью на настольный теннис (Telegram). Архитектура по DDD: domain → application → infrastructure → interfaces.

## Запуск
1. `npm install`
2. В `.env` задайте `TG_BOT_API_TOKEN`.
3. `npm start`

## Тесты
- Unit: `npm test` (Jest, покрыты доменный сервис и use-case создания матча).

## Архитектура
- Краткое описание слоёв и потоков: `docs/architecture.md`.
- Сообщения и тексты: `src/application/messages/templates.js`.

## Основные команды
- `/start` — подключает чат к уведомлениям и выводит приветствие.
- Inline query:
  - «Найти игрока» — ставит игрока в поиск.
  - «Проверить очередь» — выводит очередь матчей.
  - «Посмотреть тех, кто уже отыграл» — список сыгравших.

