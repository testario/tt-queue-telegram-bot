# Фаза 3: Отображение очереди (read-only)

**Статус:** В работе
**Начато:** 2026-04-20

## Журнал выполнения

### 3.3 shared/ui/CountdownTimer.vue (обновление)

**Что сделано:** Добавлен `watch` на prop `endDate` — при смене матча таймер перезапускается без размонтирования. Добавлена остановка интервала при истечении времени (`ms <= 0`).
**Файлы:** `mini-app/src/shared/ui/CountdownTimer.vue`

### 3.4 shared/ui/PlayerTag.vue (обновление)

**Что сделано:** Переименован prop с `username` на `name` для соответствия плану. Изменение не ломает другие компоненты — PlayerTag ещё не использовался.
**Файлы:** `mini-app/src/shared/ui/PlayerTag.vue`

### 3.2 features/queue/MatchCard.vue

**Что сделано:** Создана карточка матча. Для текущего матча со статусом `playing` показывает CountdownTimer. Для остальных — время начала/окончания через `formatTime`. Позиция в очереди отображается через prop `position`.
**Файлы:** `mini-app/src/features/queue/MatchCard.vue`

### 3.5 features/played/PlayedView.vue

**Что сделано:** Создан компонент списка отыгравших. Показывает пустое состояние если список пуст, иначе — список username через PlayerTag.
**Файлы:** `mini-app/src/features/played/PlayedView.vue`

### 3.6 + 3.1 features/search/SearchPanel.vue + QueueView.vue

**Что сделано:** Создан read-only SearchPanel для фазы 3 — только показывает список ищущих игроков без кнопок (кнопки будут добавлены в фазе 4). Реализован полный QueueView: загрузка (`state.loading`), ошибка (`state.error`), пауза-баннер, активный матч, список очереди, SearchPanel, PlayedView.
**Файлы:** `mini-app/src/features/search/SearchPanel.vue`, `mini-app/src/features/queue/QueueView.vue`
**Решения:** SearchPanel в фазе 3 — заглушка без кнопок, фаза 4 полностью заменит его содержимое. Это позволяет QueueView компилироваться уже сейчас.

### Сборка

**Что сделано:** `npm run build` — 28 модулей, 0 ошибок, dist/index.html + assets созданы.
**Файлы:** `mini-app/dist/`

## Итог

**Статус:** Частично завершена
**Выполнено критериев:** 0 из 7 (все требуют запуска в браузере/Telegram)
**Невыполненные критерии:**
- Все 7 критериев требуют живого браузера с работающим backend и/или Telegram окружения — верификация при деплое (фаза 6).
- Код реализован полностью согласно плану; `npm run build` проходит успешно (28 модулей).

**Следующая фаза:** phase-4-player-actions
