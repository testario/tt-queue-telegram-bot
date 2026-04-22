# Этап 6: Деплой и регистрация Mini App

## Цель

Собрать Mini App, настроить раздачу статики через Nginx, зарегистрировать
веб-приложение в BotFather и проверить работу в боевых условиях.

## 6.1 Сборка фронтенда

```bash
cd mini-app
npm run build
# Результат: mini-app/dist/
```

Директория `mini-app/dist/` содержит статические файлы. Они раздаются Express или Nginx.

**Автоматизация сборки при деплое** — добавить в корневой `package.json`:

```json
"scripts": {
  "build:webapp": "cd mini-app && npm run build",
  "deploy": "npm run build:webapp && pm2 restart tt-queue-bot"
}
```

## 6.2 Nginx — раздача статики и проксирование API

Mini App должна быть доступна по HTTPS — это обязательное требование Telegram.
Статика раздаётся Nginx, API-запросы проксируются к Express.

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Статика Mini App
    root /opt/tt-queue-bot/mini-app/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # API + SSE — проксируем к Express
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # SSE требует отключения буферизации
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Connection '';
        chunked_transfer_encoding on;
    }
}

# Редирект HTTP → HTTPS
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}
```

**Ключевые настройки для SSE:**
- `proxy_buffering off` — без этого SSE-события не доходят до клиента
- `proxy_http_version 1.1` — нужен для keep-alive соединений
- `Connection ''` — убирает заголовок `Connection: upgrade` от Nginx

## 6.3 Переменные окружения

Добавить в `.env` на сервере:

```env
# WebApp
WEBAPP_PORT=3000
# TG_BOT_TOKEN уже должен быть задан
```

## 6.4 Регистрация Mini App в BotFather

1. Открыть @BotFather в Telegram
2. Выбрать бота командой `/mybots`
3. Нажать **Bot Settings → Menu Button** (или **Configure Mini App**)
4. Выбрать **Edit Menu Button URL**
5. Ввести URL: `https://your-domain.com`
6. Опционально — задать текст кнопки: "Открыть очередь"

После этого в чате бота появится кнопка рядом с полем ввода, которая открывает Mini App.

**Альтернатива — inline кнопка в сообщениях бота:**

Добавить кнопку открытия Mini App к сообщениям о состоянии очереди:

```js
// В bot.js при ответе на /queue
const webAppUrl = process.env.WEBAPP_URL  // https://your-domain.com
const keyboard = webAppUrl
  ? {
      inline_keyboard: [[
        { text: '📱 Открыть очередь', web_app: { url: webAppUrl } }
      ]]
    }
  : undefined

await bot.sendMessage(chatId, queueText, {
  reply_markup: keyboard,
  reply_to_message_id: msg.message_id,
})
```

## 6.5 Проверка initData на production

В продакшене `initData` всегда корректная, если приложение открыто через Telegram.
При разработке `initData` пустая — нужно её мокировать.

**Для разработки** — добавить в auth middleware режим bypass:

```js
// auth.js
const isDev = process.env.NODE_ENV !== 'production'

export const authMiddleware = (req, res, next) => {
  const initData = req.headers['x-telegram-init-data']

  if (isDev && !initData) {
    // Мок для локальной разработки
    req.tgUser = { id: 123456, username: 'dev_user', first_name: 'Dev' }
    req.player = '@dev_user'
    return next()
  }

  // ... обычная валидация
}
```

**Для тестирования initData** в браузере можно использовать Telegram Desktop
с включёнными DevTools (через `telegram://setenvdevelopment?value=1`).

## 6.6 Content Security Policy

Telegram требует, чтобы Mini App не имела проблем с CSP. Добавить заголовки в Nginx:

```nginx
add_header Content-Security-Policy "
  default-src 'self';
  script-src 'self' https://telegram.org;
  connect-src 'self' https://api.telegram.org;
  style-src 'self' 'unsafe-inline';
" always;
```

## 6.7 Чеклист деплоя

### Инфраструктура
- [ ] SSL-сертификат установлен и работает (Let's Encrypt / другой)
- [ ] Nginx настроен с поддержкой SSE (`proxy_buffering off`)
- [x] `WEBAPP_PORT` задан в `.env`
- [x] `WEBAPP_URL` задан в `.env` (для кнопки в боте)

### Сборка
- [x] `cd mini-app && npm install && npm run build` выполняется без ошибок
- [ ] `mini-app/dist/` скопирован/доступен Nginx

### Регистрация
- [ ] В BotFather задан Menu Button URL
- [ ] Mini App открывается из Telegram без ошибок

### Функциональность
- [ ] `useTelegram().player` возвращает корректный `@username` на production
- [ ] `GET /api/state` возвращает данные
- [ ] SSE-события приходят в реальном времени
- [ ] Кнопка "Ищу соперника" работает
- [ ] Кнопка "Нет времени" работает
- [ ] Admin-функции доступны только администраторам
- [ ] При закрытии и повторном открытии Mini App состояние актуально

## 6.8 Мониторинг

Fastify-сервер работает в том же процессе, что и бот. Если процесс падает —
падает всё. Для мониторинга использовать тот же инструмент, что уже настроен
для бота (pm2, systemd и т.д.).

Добавить логирование запросов к API в `webapp/index.js`:

```js
app.use((req, res, next) => {
  log.info('WebApp request', { method: req.method, path: req.path })
  next()
})
```

## 6.9 Обновление

При изменении фронтенда:
```bash
cd mini-app && npm run build
# Nginx подхватит изменения сразу — перезапуск не нужен
```

При изменении backend (router.js, auth.js):
```bash
pm2 restart tt-queue-bot  # или аналог
```
