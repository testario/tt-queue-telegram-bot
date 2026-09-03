# Фаза 6: Деплой и регистрация Mini App

**Статус:** В работе
**Начато:** 2026-04-20

## Журнал выполнения

### 6.1 Сборка фронтенда — scripts в package.json

**Что сделано:** В корневой `package.json` добавлены скрипты `build:webapp` и `deploy` для автоматизации сборки фронтенда и перезапуска через pm2.
**Файлы:** `package.json`

### 6.3 Переменные окружения

**Что сделано:** В `.env` добавлены `WEBAPP_PORT=3000` и `WEBAPP_URL=https://your-domain.com` (заполнить реальным доменом при деплое).
**Файлы:** `.env`

### 6.5 Dev-режим авторизации (bypass initData)

**Что сделано:** В `auth` preHandler в router.js добавлен bypass: если `NODE_ENV !== 'production'` и `X-Telegram-Init-Data` отсутствует — запрос проходит с mock-пользователем `@dev_user`. Позволяет тестировать API из браузера без Telegram.
**Файлы:** `src/interfaces/webapp/router.js`

## Ожидаемые действия при деплое

Следующие шаги требуют доступа к серверу и выполняются вручную:

### 6.2 Nginx
- Настроить `proxy_buffering off` для SSE на `/api/` локации
- Прописать `root /opt/tt-queue-bot/mini-app/dist` для статики

### 6.4 BotFather
- Через `/mybots` → Bot Settings → Menu Button задать URL Mini App

## Итог

**Статус:** Частично завершена
**Выполнено критериев:** 1 из 13

**Выполненные критерии:**
- [x] `cd mini-app && npm install && npm run build` выполняется без ошибок (41 модуль, 0 ошибок)

**Невыполненные критерии (требуют сервера/Telegram):**
- SSL-сертификат — требует VPS
- Nginx — требует VPS
- Env vars на сервере — требует VPS
- Dist доступен Nginx — требует VPS
- BotFather Menu Button — требует Telegram аккаунта с доступом к боту
- Mini App открывается из Telegram — требует Telegram
- Функциональные проверки (SSE, кнопки, admin) — требуют Telegram

**Следующая фаза:** деплой на VPS
