# Этап 10: Docker Compose — сборка всех сервисов

## Цель

Упаковать проект в набор Docker-сервисов и описать их в `docker-compose.yml`.
Итоговый стек: `mongodb`, `redis`, `bot`, `backend`, `frontend` (nginx).

## 10.1 Структура файлов

```
tt-queue-bot/
├── Dockerfile.bot          # НОВЫЙ — образ для bot-процесса
├── Dockerfile.backend      # НОВЫЙ — образ для backend-процесса
├── nginx/
│   └── default.conf        # НОВЫЙ — конфиг nginx для frontend
├── docker-compose.yml      # НОВЫЙ
└── .env.example            # НОВЫЙ — шаблон переменных окружения
```

## 10.2 Dockerfile.bot

```dockerfile
# Dockerfile.bot
FROM node:22-alpine

WORKDIR /app

# Устанавливаем только prod-зависимости
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src/ ./src/

# Node.js path aliases (package.json imports field)
# Нет компиляции — чистый ESM

ENV NODE_ENV=production

CMD ["node", "src/index-bot.js"]
```

## 10.3 Dockerfile.backend

```dockerfile
# Dockerfile.backend
FROM node:22-alpine AS builder

WORKDIR /app

# Сначала собираем фронтенд
COPY mini-app/package.json mini-app/package-lock.json ./mini-app/
RUN cd mini-app && npm ci

COPY mini-app/ ./mini-app/
RUN cd mini-app && npm run build
# Результат: /app/mini-app/dist/

# ──────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src/ ./src/
# Статика фронтенда из builder-стадии
COPY --from=builder /app/mini-app/dist ./mini-app/dist

ENV NODE_ENV=production

CMD ["node", "src/index-backend.js"]
```

Фронтенд собирается внутри backend-образа — упрощает деплой (один образ,
нет зависимости от отдельного builder-шага на хосте).

## 10.4 nginx/default.conf

```nginx
server {
    listen 80;

    # Статика Mini App (из volume, смонтированного из backend-контейнера)
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # API + SSE — проксируем к backend-сервису
    location /api/ {
        proxy_pass http://backend:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # SSE: обязательно отключаем буферизацию
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Connection '';
        chunked_transfer_encoding on;
    }
}
```

**Примечание по HTTPS:** В продакшене перед nginx ставится внешний reverse proxy
(Caddy, Traefik, или Nginx на хосте) с SSL-терминацией. Внутренний nginx в Docker
работает по HTTP — это стандартная схема.

## 10.5 docker-compose.yml

```yaml
# docker-compose.yml
services:

  mongodb:
    image: mongo:7
    restart: unless-stopped
    volumes:
      - mongodb_data:/data/db
    environment:
      MONGO_INITDB_DATABASE: tt-queue-bot
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - internal

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - internal

  bot:
    build:
      context: .
      dockerfile: Dockerfile.bot
    restart: unless-stopped
    env_file: .env
    environment:
      REDIS_URL: redis://redis:6379
    depends_on:
      redis:
        condition: service_healthy
    networks:
      - internal

  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    restart: unless-stopped
    env_file: .env
    environment:
      REDIS_URL: redis://redis:6379
      PLAYERS_MONGODB_URI: mongodb://mongodb:27017
      PLAYERS_MONGODB_DB: tt-queue-bot
      WEBAPP_PORT: 3000
    depends_on:
      redis:
        condition: service_healthy
      mongodb:
        condition: service_healthy
    networks:
      - internal

  frontend:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "80:80"
    volumes:
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
      # Статика копируется из backend-образа при сборке:
      # docker cp backend:/app/mini-app/dist /tmp/dist && docker cp /tmp/dist frontend:/usr/share/nginx/html
      # Или используем init-контейнер (см. ниже)
    depends_on:
      - backend
    networks:
      - internal
      - external

volumes:
  mongodb_data:
  redis_data:

networks:
  internal:
    driver: bridge
  external:
    driver: bridge
```

### Решение проблемы раздачи статики

Два подхода для передачи `mini-app/dist/` из backend-образа в nginx:

**Вариант А (проще) — named volume:**

```yaml
  backend:
    volumes:
      - frontend_dist:/app/mini-app/dist

  frontend:
    volumes:
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
      - frontend_dist:/usr/share/nginx/html:ro

volumes:
  frontend_dist:
```

Оба сервиса разделяют один volume. Backend при старте уже имеет `dist/` внутри образа —
файлы попадают в volume автоматически при первом монтировании.

**Вариант Б (явный) — отдельная сборка фронтенда на хосте:**

```bash
# На сервере при деплое:
cd mini-app && npm ci && npm run build
# Nginx монтирует ./mini-app/dist/ напрямую:
```

```yaml
  frontend:
    volumes:
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
      - ./mini-app/dist:/usr/share/nginx/html:ro
```

Рекомендуется **Вариант А** для чистого Docker-деплоя.

## 10.6 .env.example

```env
# Telegram
TG_BOT_API_TOKEN=your_bot_token_here
TG_CHAT_ID=-100xxxxxxxxxx

# Webapp
WEBAPP_PORT=3000
WEBAPP_URL=https://your-domain.com

# Redis (для docker-compose переопределяется в services)
REDIS_URL=redis://localhost:6379

# MongoDB (для docker-compose переопределяется в services)
PLAYERS_MONGODB_URI=mongodb://localhost:27017
PLAYERS_MONGODB_DB=tt-queue-bot
PLAYERS_MONGODB_COLLECTION=players

# Опционально
NODE_ENV=production
```

## 10.7 Команды управления

```bash
# Первый запуск
docker compose up -d --build

# Пересборка после изменений
docker compose up -d --build bot         # только бот
docker compose up -d --build backend     # бот + фронтенд

# Логи
docker compose logs -f bot
docker compose logs -f backend

# Остановка
docker compose down

# Полный сброс с данными
docker compose down -v
```

## 10.8 Healthcheck для бота

Бот не имеет HTTP-сервера, поэтому healthcheck через файл:

```dockerfile
# В Dockerfile.bot добавить:
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD test -f /tmp/bot-alive || exit 1
```

```js
// В src/index-bot.js после успешного запуска:
import { writeFileSync } from 'fs'
writeFileSync('/tmp/bot-alive', Date.now().toString())
```

## 10.9 Чеклист деплоя

### Подготовка сервера
- [ ] Docker и Docker Compose установлены
- [ ] `.env` создан из `.env.example` с реальными значениями
- [ ] SSL-терминация настроена (внешний reverse proxy / Caddy)

### Сборка и запуск
- [ ] `docker compose up -d --build` — все 5 сервисов стартуют без ошибок
- [ ] `docker compose ps` — все сервисы `Up (healthy)`
- [ ] `docker compose logs bot` — нет ошибок подключения к Redis
- [ ] `docker compose logs backend` — нет ошибок подключения к Redis и MongoDB

### Функциональность
- [ ] `curl http://localhost/api/state` возвращает JSON
- [ ] Mini App открывается в браузере по HTTP (и через Telegram по HTTPS)
- [ ] Действие в боте → SSE обновляет Mini App
- [ ] Действие в Mini App → сообщение в Telegram чат
- [ ] После `docker compose restart bot` таймеры восстанавливаются (recoverTimers)
- [ ] После `docker compose restart backend` SSE переподключается к Redis

### Персистентность
- [ ] После `docker compose down && docker compose up -d` состояние очереди сохранено в Redis
- [ ] Список игроков сохранён в MongoDB

## Критерии готовности этапа

- [ ] `docker compose up -d --build` поднимает все 5 сервисов без ошибок
- [ ] `frontend` отдаёт Mini App, `/api/` проксируется к `backend`
- [x] `bot` и `backend` не могут стартовать раньше `redis` (depends_on + healthcheck)
- [x] `backend` не может стартовать раньше `mongodb`
- [ ] Данные Redis и MongoDB персистируются в named volumes
- [x] `.env.example` содержит все необходимые переменные с комментариями
