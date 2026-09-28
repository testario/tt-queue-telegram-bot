# xray-прокси для доступа к Telegram

Контейнер `xray` в `docker-compose.yml` / `docker-compose.vps-dev.yml` — локальный
HTTP-прокси (`http://xray:1080` изнутри Docker-сети) для `bot` и `backend`.
Он нужен на VPS, где `api.telegram.org` заблокирован (РФ): вместо прямого
подключения запросы уходят через xray-туннель до сервера за пределами РФ.

## Настройка

1. Скопируйте пример и отредактируйте:
   ```bash
   cp xray/config.example.json xray/config.json
   ```
   `xray/config.json` в `.gitignore` — секреты (UUID, ключи) в репозиторий не
   попадают.

2. По умолчанию в `config.example.json` outbound — `freedom` (прямое
   подключение). Это безопасный no-op: контейнер поднимается и работает как
   прозрачный HTTP-прокси, ничего не меняя в поведении. Пока outbound не
   заменён на реальный туннель, блокировка Telegram в РФ никуда не денется —
   это просто рабочее состояние "прокси есть, но не используется".

3. Когда VPN-сервер в Нидерландах настроен как xray-сервер (например, VLESS +
   Reality), замените блок `outbounds` в `xray/config.json` на конфигурацию
   клиента для этого сервера. Пример для VLESS + Reality:

   ```json
   "outbounds": [
     {
       "protocol": "vless",
       "tag": "proxy",
       "settings": {
         "vnext": [
           {
             "address": "your-nl-server.example.com",
             "port": 443,
             "users": [
               {
                 "id": "UUID-клиента",
                 "encryption": "none",
                 "flow": "xtls-rprx-vision"
               }
             ]
           }
         ]
       },
       "streamSettings": {
         "network": "tcp",
         "security": "reality",
         "realitySettings": {
           "serverName": "SNI-домен-маскировки",
           "publicKey": "публичный ключ Reality",
           "shortId": "shortId",
           "fingerprint": "chrome"
         }
       }
     }
   ]
   ```

   Точные значения (`id`, `publicKey`, `shortId`, `serverName`) берутся из
   конфигурации xray-сервера в Нидерландах — их нужно сгенерировать там при
   настройке inbound. Для VMess/Trojan/Shadowsocks структура `outbounds`
   другая — используйте конфиг, который выдаёт ваш xray-сервер для клиента.

4. Пересоздайте контейнер, чтобы подхватить новый конфиг:
   ```bash
   docker compose up -d --force-recreate xray
   docker compose logs -f xray
   ```
   При успешном старте в логах нет ошибок парсинга конфига. Проверить, что
   прокси реально работает, можно из контейнера bot/backend:
   ```bash
   docker compose exec bot wget -qO- --header="Host: api.telegram.org" \
     -e use_proxy=yes -e http_proxy=http://xray:1080 https://api.telegram.org
   ```

## Как это подключено к боту

`bot` и `backend` получают `HTTP_PROXY=http://xray:1080` через
`environment:` в docker-compose (см. `docker-compose.yml`). Node-клиент
Telegram (`node-telegram-bot-api`) сам читает эту переменную окружения — код
проекта менять не нужно (см. `src/interfaces/telegram/bot.js` и
`src/index-backend.js`).

Если бэкенд/бот запускаются не в Docker (например, через PM2 напрямую на
хосте), поднимите xray как системный сервис и укажите его локальный адрес в
`.env` через `HTTP_PROXY=http://127.0.0.1:1080`.
