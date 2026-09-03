# Развёртывание dev-стенда на VPS

Этот гайд поднимает только dev-стенд по адресу
`https://tt-bot.dev.liffesteel.ru`. Домен `tt-bot.liffesteel.ru` и
продовый compose-файл не используются и не меняются.

Стек запускается из `docker-compose.vps-dev.yml`:

- `caddy` принимает публичные HTTPS-запросы;
- `frontend` отдаёт Mini App и проксирует `/api/*` к backend;
- `bot`, `backend`, `redis` и `mongodb` доступны только во внутренней Docker-сети.

Так наружу открыты лишь порты `80` и `443`. Dev-стенд работает с
`NODE_ENV=production`: это важно, потому что только так backend проверяет
Telegram `initData` и не включает browser-only dev-авторизацию.

Mini App собирается в отдельный образ `frontend` (`Dockerfile.frontend`), поэтому
после каждого `up --build` nginx получает актуальную сборку без ручного копирования
файлов или общего volume с backend.

## 1. Что потребуется

- VPS с Ubuntu 22.04/24.04 или Debian, минимум 1 GB RAM (2 GB комфортнее);
- публичный IPv4-адрес; если для домена есть AAAA-запись, VPS также должен быть
  доступен по IPv6;
- SSH-доступ и свободные порты `80` и `443`;
- отдельный Telegram-бот и тестовый групповой чат. Это рекомендуемый вариант:
  Telegram разрешает только один polling-процесс на токен, а dev-бот не смешает
  тестовую очередь с будущей production-очередью.

Установите Docker Engine и Compose plugin по
[официальной инструкции Docker](https://docs.docker.com/engine/install/ubuntu/).
После установки достаточно проверить:

```bash
docker --version
docker compose version
```

Если команды требуют `sudo`, можно либо использовать его в командах ниже, либо
выполнить [post-install шаг Docker](https://docs.docker.com/engine/install/linux-postinstall).
Добавление пользователя в группу `docker` фактически даёт ему root-подобный
доступ к хосту — это нормально только для доверенного пользователя VPS.

## 2. DNS и сетевой доступ

В DNS-панели создайте запись:

| Тип | Имя | Значение |
| --- | --- | --- |
| A | `tt-bot.dev` | публичный IPv4 VPS |

Полное имя записи будет `tt-bot.dev.liffesteel.ru`. Если существует AAAA-запись,
она должна указывать на рабочий IPv6 этого же VPS; иначе удалите её. Проверьте
результат уже на сервере:

```bash
dig +short A tt-bot.dev.liffesteel.ru
dig +short AAAA tt-bot.dev.liffesteel.ru
```

Разрешите входящий HTTP/HTTPS в панели провайдера и firewall. Для UFW при
стандартном SSH-порте это выглядит так:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Если SSH работает на нестандартном порту, сначала разрешите именно его, иначе
не включайте UFW до проверки доступа в отдельной SSH-сессии.

Caddy автоматически получит и будет обновлять TLS-сертификат. Для этого DNS
должен уже вести на VPS, а порты `80` и `443` должны быть доступны извне.
[Это требования Caddy для автоматического HTTPS](https://caddyserver.com/docs/automatic-https).

## 3. Подготовка проекта и секретов

На VPS клонируйте репозиторий в отдельный каталог и переключитесь на ветку,
которую хотите выкатывать в dev. В примере это `develop`; замените её, если
dev должен следить за другой веткой.

```bash
sudo mkdir -p /opt/tt-queue-bot
sudo chown "$USER":"$USER" /opt/tt-queue-bot
git clone git@github.com:testario/tt-queue-telegram-bot.git /opt/tt-queue-bot
cd /opt/tt-queue-bot
git switch develop
```

Создайте секретный файл окружения из шаблона:

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

Заполните как минимум:

```env
TG_BOT_API_TOKEN=<токен dev-бота из @BotFather>
TG_CHAT_ID=<id тестового группового чата, обычно начинается с -100>
WEBAPP_URL=https://tt-bot.dev.liffesteel.ru
```

Не добавляйте `.env` в Git и не отправляйте его в чат. Файл уже игнорируется
проектом. `WEBAPP_URL` хранит публичный адрес стенда, но не настраивает кнопку
в Telegram автоматически — это отдельный шаг ниже.

## 4. Первый запуск

Убедитесь, что на VPS нет другого сервиса, занятого на `80` или `443`, затем
соберите и запустите отдельный dev-compose:

```bash
docker compose -f docker-compose.vps-dev.yml config
docker compose -f docker-compose.vps-dev.yml up -d --build
docker compose -f docker-compose.vps-dev.yml ps
```

Ожидаемые сервисы: `mongodb`, `redis`, `bot`, `backend`, `frontend`, `caddy`.
`mongodb` и `redis` должны стать healthy; бот и backend должны быть `Up`.

Проверьте запуск и выдачу сертификата:

```bash
docker compose -f docker-compose.vps-dev.yml logs --tail=100 bot backend caddy
curl -I https://tt-bot.dev.liffesteel.ru
curl https://tt-bot.dev.liffesteel.ru/api/state
```

Первый запрос к HTTPS может занять немного больше времени: Caddy запрашивает
сертификат. Второй `curl` должен вернуть JSON с состоянием очереди. Если Caddy
не выдаёт сертификат, в первую очередь проверьте DNS, IPv6 и доступность 80/443
снаружи, затем его логи.

## 5. Регистрация Mini App в Telegram

В `@BotFather` выберите dev-бота и выполните `/setmenubutton` (либо откройте
**Bot Settings → Menu Button**). Укажите:

- текст кнопки, например `Открыть очередь`;
- URL: `https://tt-bot.dev.liffesteel.ru/app/`.

Telegram Mini Apps, открытые из menu button, получают URL именно из этой
настройки. [BotFather и menu button — штатный способ настройки](https://core.telegram.org/bots/webapps#launching-mini-apps-from-the-menu-button).

Добавьте dev-бота в тестовый чат, выведите его из приватного режима при
необходимости и задайте `TG_CHAT_ID` этого чата. После изменения `.env`
перезапустите только зависящие от него сервисы:

```bash
docker compose -f docker-compose.vps-dev.yml up -d --force-recreate bot backend
```

Откройте кнопку из Telegram, а не только в обычном браузере: это проверяет
передачу `initData`, авторизацию API и SSE-обновления. Обычный браузер может
показать landing page — это ожидаемая защита Mini App.

## 6. Обновление и обслуживание

Для следующего деплоя:

```bash
cd /opt/tt-queue-bot
git pull --ff-only
docker compose -f docker-compose.vps-dev.yml up -d --build
docker compose -f docker-compose.vps-dev.yml ps
```

Полезные команды:

```bash
# Логи конкретного сервиса
docker compose -f docker-compose.vps-dev.yml logs -f bot
docker compose -f docker-compose.vps-dev.yml logs -f backend

# Перезапуск без пересборки
docker compose -f docker-compose.vps-dev.yml restart bot backend

# Остановка стенда с сохранением Redis, MongoDB и TLS-сертификатов
docker compose -f docker-compose.vps-dev.yml down
```

Не используйте `docker compose ... down -v`, если хотите сохранить очередь,
список игроков и сертификаты: эта команда удаляет named volumes с данными.

## 7. Краткая диагностика

| Симптом | Что проверить |
| --- | --- |
| Caddy не получает сертификат | DNS A/AAAA, свободные и доступные извне порты 80/443, `logs caddy` |
| Бот постоянно перезапускается | `TG_BOT_API_TOKEN`, `TG_CHAT_ID`, `logs bot`; убедитесь, что другой процесс не использует этот токен для polling |
| Mini App не открывается | в BotFather должен быть URL с HTTPS и суффиксом `/app/` |
| API отвечает 401 в Telegram | токен в `.env` должен принадлежать тому же боту, из которого открыта Mini App |
| Сайт открывается, но API недоступен | `logs backend frontend`; проверьте `curl https://tt-bot.dev.liffesteel.ru/api/state` |

Когда понадобится production, создайте для него отдельный compose-проект,
отдельные volumes и Caddy site для `tt-bot.liffesteel.ru`. Не меняйте этот
dev-стенд в production-режим заменой домена: так сохраняется независимость
данных, токенов и тестового чата.
