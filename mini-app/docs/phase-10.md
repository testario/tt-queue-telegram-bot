# Фаза 10: Docker Compose — сборка всех сервисов

**Статус:** В работе
**Начато:** 2026-04-22

## Журнал выполнения

### 10.2 Dockerfile.bot

**Что сделано:** Создан `Dockerfile.bot` на базе `node:22-alpine`. Копирует `package.json` + `package-lock.json`, устанавливает только prod-зависимости (`npm ci --omit=dev`), копирует `src/`. Добавлен HEALTHCHECK через файл `/tmp/bot-alive` (бот не имеет HTTP-сервера).
**Файлы:** `Dockerfile.bot`

### 10.3 Dockerfile.backend

**Что сделано:** Создан `Dockerfile.backend` с multi-stage сборкой. Stage `builder` собирает фронтенд (`npm ci` + `npm run build`). Финальный stage копирует `src/` + `mini-app/dist/` из builder. Фронтенд собирается внутри образа — деплой не требует отдельного build-шага на хосте.
**Файлы:** `Dockerfile.backend`

### 10.4 nginx/default.conf

**Что сделано:** Создан конфиг Nginx. Статика раздаётся из `/usr/share/nginx/html` (volume). `/api/` проксируется к `http://backend:3000` с обязательными SSE-настройками: `proxy_buffering off`, `proxy_http_version 1.1`, `Connection ''`.
**Файлы:** `nginx/default.conf`

### 10.5 docker-compose.yml

**Что сделано:** Создан `docker-compose.yml` с 5 сервисами: `mongodb` (mongo:7), `redis` (redis:7-alpine), `bot` (Dockerfile.bot), `backend` (Dockerfile.backend), `frontend` (nginx:alpine). Использован Вариант А для раздачи статики — `named volume` `frontend_dist` разделяется между `backend` (запись) и `frontend` (чтение). Healthcheck-зависимости: `bot` ждёт `redis`, `backend` ждёт `redis` + `mongodb`.
**Файлы:** `docker-compose.yml`
**Решения:** `frontend_dist` volume вместо копирования файлов — backend монтирует `mini-app/dist` в volume, nginx читает оттуда. Упрощает деплой без ручного `docker cp`.

### 10.6 .env.example

**Что сделано:** Создан `.env.example` со всеми необходимыми переменными и комментариями. Включает: `TG_BOT_API_TOKEN`, `TG_CHAT_ID`, `WEBAPP_PORT`, `WEBAPP_URL`, `REDIS_URL`, `PLAYERS_MONGODB_URI`, `PLAYERS_MONGODB_DB`, `PLAYERS_MONGODB_COLLECTION`, `NODE_ENV`.
**Файлы:** `.env.example`

### 10.8 Healthcheck для бота

**Что сделано:** В `Dockerfile.bot` добавлен `HEALTHCHECK` — проверяет наличие файла `/tmp/bot-alive`. В `src/index-bot.js` после успешного запуска записывается этот файл через `writeFileSync`. Это даёт Docker возможность отслеживать живость процесса без HTTP-сервера.
**Файлы:** `Dockerfile.bot`, `src/index-bot.js`

### Проверка тестов

**Что сделано:** `npm test` — 71 тест, 16 суитов, 0 ошибок. Добавление `writeFileSync` в `index-bot.js` не затрагивает тесты (тесты не импортируют этот файл напрямую). Синтаксис `index-bot.js` проверен через `node --check`.
**Файлы:** все тесты в `src/__tests__/`

## Итог

**Статус:** Частично завершена
**Выполнено критериев:** 3 из 6

**Выполненные критерии:**
- [x] `bot` и `backend` не могут стартовать раньше `redis` — `depends_on.redis.condition: service_healthy` в docker-compose.yml
- [x] `backend` не может стартовать раньше `mongodb` — `depends_on.mongodb.condition: service_healthy`
- [x] `.env.example` содержит все необходимые переменные с комментариями

**Невыполненные критерии (требуют запуска Docker):**
- `docker compose up -d --build` — требует Docker на сервере
- `frontend` отдаёт Mini App — требует запуска контейнеров
- Данные персистируются в named volumes — требует запуска + перезапуска

Все файлы созданы (`Dockerfile.bot`, `Dockerfile.backend`, `nginx/default.conf`, `docker-compose.yml`, `.env.example`). Healthcheck для бота реализован. `npm test` — 71 тест, 0 ошибок.

**Следующая фаза:** деплой на VPS (`docker compose up -d --build`)
