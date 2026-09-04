# Развёртывание dev-стенда на VPS через Git worktree

Гайд поднимает только dev-стенд по адресу
`https://tt-bot.dev.liffesteel.ru`. `tt-bot.liffesteel.ru` и production не
настраиваются.

Рабочая схема:

```text
/home/liffesteel/tt-queue-telegram-bot  — основной репозиторий
                 │
                 └── git worktree (origin/develop)
                       │
                       ▼
        /home/liffesteel/deploy/tt-queue-dev
                       │
                       ├── Docker: bot, backend, Redis, MongoDB, frontend
                       └── frontend → 127.0.0.1:8081
                                              │
                                              ▼
                  system nginx + Certbot → HTTPS-домен
```

`git worktree` позволяет держать независимые checkout’ы разных веток рядом;
основной рабочий каталог не нужно переключать для деплоя. Это штатное поведение
Git: worktree связан с одним репозиторием, но имеет собственные `HEAD` и index.
[Документация Git](https://git-scm.com/docs/git-worktree).

Dev-стенд должен работать с `NODE_ENV=production`. В этом проекте
`NODE_ENV=development` отключает проверку Telegram `initData` и уведомления в
чат из API; название окружения задаётся доменом, веткой и отдельным ботом, а не
значением Node environment.

## 1. Подготовить VPS

Нужны Docker Engine с Compose plugin, Nginx, свободные порты `80` и `443`, а
также отдельные dev-бот и тестовый Telegram-чат. Docker устанавливайте по
[официальной инструкции](https://docs.docker.com/engine/install/ubuntu/).

Для Ubuntu/Debian установите Nginx и откройте входящий HTTP/HTTPS (и в firewall
провайдера, если он есть):

```bash
sudo apt update
sudo apt install -y nginx
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Если SSH работает на нестандартном порту, сначала разрешите именно его. Не
устанавливайте Caddy для этого стенда: Nginx будет единственным процессом,
который слушает `80` и `443`.

В DNS создайте только запись `A`:

| Тип | Имя | Значение |
| --- | --- | --- |
| A | `tt-bot.dev` | публичный IPv4 VPS |

Если для `tt-bot.dev.liffesteel.ru` есть AAAA-запись, VPS должен быть доступен
по этому IPv6; иначе AAAA лучше удалить. Проверьте DNS на сервере:

```bash
dig +short A tt-bot.dev.liffesteel.ru
dig +short AAAA tt-bot.dev.liffesteel.ru
```

## 2. Создать dev worktree

В проекте сейчас существует ветка `develop`. Команда ниже создаёт локальную
ветку `deploy-dev`, отслеживающую `origin/develop`, и checkout в отдельном
каталоге. Локальное имя `deploy-dev` важно: оно позволяет оставить `develop`
открытой в основном рабочем каталоге, если она там уже используется.

```bash
cd /home/liffesteel/tt-queue-telegram-bot
git fetch origin --prune
mkdir -p /home/liffesteel/deploy
git worktree add --track -b deploy-dev \
  /home/liffesteel/deploy/tt-queue-dev origin/develop
git worktree list
```

Если ваша ветка называется `dev`, замените `origin/develop` на `origin/dev`.
Повторно создавать существующий worktree не нужно. Если локальная ветка
`deploy-dev` уже была создана ранее, используйте:

```bash
git worktree add /home/liffesteel/deploy/tt-queue-dev deploy-dev
```

Впоследствии для production можно будет создать соседний worktree, например
`deploy-prod`, отслеживающий `origin/main`, но этот гайд его не создаёт.

## 3. Задать dev-секреты

У каждого worktree свой игнорируемый `.env`, поэтому токены и chat id не
пересекаются с будущим production-окружением:

```bash
cd /home/liffesteel/deploy/tt-queue-dev
cp .env.example .env
chmod 600 .env
nano .env
```

Заполните минимум следующие значения:

```env
TG_BOT_API_TOKEN=<токен отдельного dev-бота из @BotFather>
TG_CHAT_ID=<id тестового группового чата, обычно -100...>
WEBAPP_URL=https://tt-bot.dev.liffesteel.ru
NODE_ENV=production
```

Не добавляйте `.env` в Git. `VITE_APP_URL` не нужен: frontend этого проекта не
читает его, а API и SSE вызываются по относительным путям того же домена.

## 4. Запустить Docker-стек

`docker-compose.vps-dev.yml` использует отдельное имя проекта
`tt-queue-bot-dev`. Его Redis и MongoDB получат отдельные named volumes, что
позволит позднее запустить production без пересечения данных.

```bash
cd /home/liffesteel/deploy/tt-queue-dev
docker compose -f docker-compose.vps-dev.yml config --quiet
docker compose -f docker-compose.vps-dev.yml up -d --build
docker compose -f docker-compose.vps-dev.yml ps
```

Mini App собирается внутри Docker-образа `frontend`; выполнять `npm ci` и
`npm run build` на VPS отдельно не нужно. Наружу Docker публикует только
`127.0.0.1:8081`; bot, backend, Redis и MongoDB остаются во внутренней сети.

Проверьте сервисы до настройки HTTPS:

```bash
curl http://127.0.0.1:8081/api/state
docker compose -f docker-compose.vps-dev.yml logs --tail=100 bot backend frontend
```

Первый запрос должен вернуть JSON состояния очереди.

## 5. Настроить Nginx и HTTPS

Скопируйте подготовленный конфиг. Он проксирует весь сайт на Docker frontend и
не буферизует ответы: это необходимо для SSE-потока `/api/events`.

```bash
cd /home/liffesteel/deploy/tt-queue-dev
sudo cp deploy/nginx/tt-bot.dev.liffesteel.ru.conf \
  /etc/nginx/sites-available/tt-bot.dev.liffesteel.ru
sudo ln -s /etc/nginx/sites-available/tt-bot.dev.liffesteel.ru \
  /etc/nginx/sites-enabled/tt-bot.dev.liffesteel.ru
sudo nginx -t
sudo systemctl reload nginx
```

Проверьте HTTP до выпуска сертификата:

```bash
curl -I http://tt-bot.dev.liffesteel.ru
```

Установите Certbot для Nginx по [актуальной инструкции Certbot](https://certbot.eff.org/instructions?os=ubuntufocal&ws=nginx).
На Ubuntu она использует snap:

```bash
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/local/bin/certbot
sudo certbot --nginx -d tt-bot.dev.liffesteel.ru
sudo certbot renew --dry-run
```

Certbot добавит TLS-конфигурацию и редирект на HTTPS. Проверьте:

```bash
curl -I https://tt-bot.dev.liffesteel.ru
curl https://tt-bot.dev.liffesteel.ru/api/state
```

## 6. Подключить Telegram Mini App

В `@BotFather` выберите dev-бота и выполните `/setmenubutton` (либо **Bot
Settings → Menu Button**). Задайте URL:

```text
https://tt-bot.dev.liffesteel.ru/app/
```

Используйте отдельного dev-бота: один токен не должен одновременно обслуживаться
несколькими polling-процессами, а menu button может указывать только на один
адрес. После изменения `.env` перезапустите bot и backend:

```bash
docker compose -f docker-compose.vps-dev.yml up -d --force-recreate bot backend
```

Откройте кнопку в Telegram. Это проверяет передачу `initData`, авторизацию API
и SSE; в обычном браузере вместо Mini App может отображаться landing page — это
ожидаемо.

## 7. Независимый dev-деплой

После push в `develop` обновляется только dev worktree и только dev Docker
проект:

```bash
cd /home/liffesteel/deploy/tt-queue-dev
git pull --ff-only
docker compose -f docker-compose.vps-dev.yml up -d --build
docker compose -f docker-compose.vps-dev.yml ps
```

Nginx перезапускать не нужно: он проксирует на постоянный localhost-порт.

Полезные команды:

```bash
docker compose -f docker-compose.vps-dev.yml logs -f bot
docker compose -f docker-compose.vps-dev.yml logs -f backend
docker compose -f docker-compose.vps-dev.yml restart bot backend
docker compose -f docker-compose.vps-dev.yml down
```

Последняя команда останавливает стек, но сохраняет очередь, игроков и данные
MongoDB/Redis. Не используйте `down -v`, если данные нужно сохранить.

## Диагностика

| Симптом | Что проверить |
| --- | --- |
| Nginx отдаёт 502 | `curl http://127.0.0.1:8081/api/state`, затем `docker compose ... logs frontend backend` |
| Mini App не обновляется | `proxy_buffering off` и `proxy_read_timeout 1h` в Nginx-конфиге, `logs backend` |
| Бот перезапускается | токен, chat id, `logs bot`; не должен существовать второй polling с тем же токеном |
| HTTPS не выпускается | A/AAAA, доступность 80/443 снаружи, `sudo nginx -t`, логи Certbot |
| API возвращает 401 в Telegram | dev-бот в `.env` должен совпадать с ботом, из которого открыта Mini App |
