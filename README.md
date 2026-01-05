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
- Сообщения и тексты: `src/application/messages/localization.js` + `src/application/messages/locales/*`.

## Локализация
- Язык задаётся через переменные окружения `BOT_LOCALE` (по умолчанию `ru`) и `BOT_FALLBACK_LOCALE`.
- Конфигурация: `src/application/config/i18n.js`.
- Базовые локали: `src/application/messages/locales/ru.js` и `src/application/messages/locales/en.js`. При отсутствии ключа используется fallback.

## Основные команды
- `/start` — подключает чат к уведомлениям и выводит приветствие.
- `/play @username` — отправляет приглашение указанному оппоненту; он может принять или отклонить через кнопки в сообщении.
- Inline query:
  - «Найти игрока» — ставит игрока в поиск.
  - «Проверить очередь» — выводит очередь матчей.
  - «Посмотреть тех, кто уже отыграл» — список сыгравших.

