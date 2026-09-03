# Фаза 4: Действия игрока

**Статус:** В работе
**Начато:** 2026-04-20

## Журнал выполнения

### 4.5 Хранение pending-приглашений на сервере (router.js)

**Что сделано:** В `registerRoutes` добавлена `const pendingInvites = new Map()`. `buildStatePayload` теперь включает `pendingInvites: Array.from(pendingInvites.values())`. `POST /api/direct` добавляет запись при успехе. `POST /api/direct/accept`, `/decline`, `/cancel` удаляют запись при вызове.
**Файлы:** `src/interfaces/webapp/router.js`

### 4.1 useQueue.js — добавление pendingInvites в state

**Что сделано:** Добавлено поле `pendingInvites: []` в reactive state. `applyState` теперь обновляет `state.pendingInvites = data.pendingInvites || []`.
**Файлы:** `mini-app/src/composables/useQueue.js`

### 4.2 features/search/SearchPanel.vue (полная интерактивная версия)

**Что сделано:** Заменена read-only заглушка фазы 3 полной версией. Реализовано: регистрация поиска, отмена поиска, "Сыграть с ним" для других ищущих, "Нет времени" для текущего матча, кнопка "Пригласить конкретного игрока", отображение и отмена исходящего приглашения.
**Файлы:** `mini-app/src/features/search/SearchPanel.vue`

### 4.3 features/direct-match/DirectMatchModal.vue

**Что сделано:** Создан модал прямого приглашения с поиском по списку известных игроков (с аватарами), фильтрацией по имени/username, исключением недоступных игроков (себя, тех кто в очереди/играл), ручным вводом username и обработкой ошибок.
**Файлы:** `mini-app/src/features/direct-match/DirectMatchModal.vue`

### 4.4 features/direct-match/InviteCard.vue

**Что сделано:** Создана карточка входящего приглашения. Читает `state.pendingInvites` и находит приглашение где `opponent === currentPlayer`. Показывает кнопки "Принять" и "Отказаться".
**Файлы:** `mini-app/src/features/direct-match/InviteCard.vue`

### 4.6 QueueView.vue — добавление InviteCard

**Что сделано:** Добавлен `<InviteCard />` перед `<SearchPanel />`. Компонент рендерится только если есть входящее приглашение (внутренняя логика InviteCard).
**Файлы:** `mini-app/src/features/queue/QueueView.vue`

### Сборка

**Что сделано:** `npm run build` — 37 модулей, 0 ошибок. CSS: 6.69 kB, JS: 78.48 kB.
**Файлы:** `mini-app/dist/`

## Итог

**Статус:** Частично завершена
**Выполнено критериев:** 0 из 9 (все требуют запуска в браузере/Telegram)
**Невыполненные критерии:**
- Все 9 критериев требуют живого браузера с работающим backend и/или Telegram — верификация при деплое (фаза 6).
- Код реализован полностью согласно плану; `npm run build` проходит успешно (37 модулей).

**Следующая фаза:** phase-5-admin-panel
