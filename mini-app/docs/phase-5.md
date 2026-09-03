# Фаза 5: Панель администратора

**Статус:** В работе
**Начато:** 2026-04-20

## Журнал выполнения

### 5.1 composables/useAdmin.js (обновление до singleton)

**Что сделано:** Переписан на singleton-паттерн: `isAdmin` вынесен на module-level, `checkAdmin()` идемпотентен. `pause/resume/emerge` — сырые API-вызовы без внутреннего loading/error (управление осуществляется в AdminPanel через `handleAction`).
**Файлы:** `mini-app/src/composables/useAdmin.js`
**Решения:** Старая реализация имела per-instance loading/error, что конфликтовало с шаблоном AdminPanel из плана. Singleton нужен чтобы `checkAdmin` не вызывался повторно при ремаунте.

### 5.3 features/admin/AdminPanel.vue (полная реализация)

**Что сделано:** Реализована полная панель: статус-бейджи (Активна/На паузе/Экстренная пауза), кнопки с условной видимостью по таблице 5.4, `handleAction` с tracking loading/result, `confirmAndAct` с `tg.showPopup` / `window.confirm` fallback для экстренной паузы.
**Файлы:** `mini-app/src/features/admin/AdminPanel.vue`

### 5.8 features/admin/PlayerManager.vue

**Что сделано:** Создан компонент управления списком игроков. Загружает список через `usePlayers().load()`. Каждый игрок показывается с аватаром, именем, username. Кнопка удаления с confirm-диалогом через `tg.showPopup` / `window.confirm`. Удаление обновляет локальный кеш через `remove(username)` из `usePlayers`.
**Файлы:** `mini-app/src/features/admin/PlayerManager.vue`
**Решения:** `usePlayers.state` — readonly, поэтому прямой splice невозможен. Добавлен метод `remove(username)` в `usePlayers.js`, который мутирует внутренний (не readonly) reactive object.

### usePlayers.js — добавление метода remove

**Что сделано:** Добавлен метод `remove(username)` для удаления из локального кеша без перезапроса. Метод возвращается из composable наряду с `state`, `load`, `avatarUrl`.
**Файлы:** `mini-app/src/composables/usePlayers.js`

### Сборка

**Что сделано:** `npm run build` — 41 модуль, 0 ошибок. CSS: 8.67 kB, JS: 82.67 kB.
**Файлы:** `mini-app/dist/`

## Итог

**Статус:** Частично завершена
**Выполнено критериев:** 0 из 12 (все требуют запуска в браузере/Telegram с реальными правами)
**Невыполненные критерии:**
- Все 12 критериев требуют живого браузера с работающим backend и аккаунта администратора в чате — верификация при деплое (фаза 6).
- Код реализован полностью согласно плану; `npm run build` проходит успешно (41 модуль).

**Следующая фаза:** phase-6-deploy
