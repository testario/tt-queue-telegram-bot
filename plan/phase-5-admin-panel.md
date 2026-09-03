# Этап 5: Панель администратора

## Цель

Реализовать панель администратора с тремя действиями:
- **Пауза** — заморозить очередь
- **Продолжить** — снять паузу и запустить очередь
- **Экстренная пауза** — остановить активный матч с возможностью восстановления

Панель видна только администраторам чата.

## 5.1 composables/useAdmin.js

Composable проверяет права текущего пользователя и предоставляет методы для
admin-действий. Проверка выполняется один раз при инициализации.

```js
// useAdmin.js
import { ref } from 'vue'
import { useApi } from './useApi.js'

const isAdmin = ref(null)   // null = ещё не проверяли, true/false = результат

export function useAdmin() {
  const api = useApi()

  const checkAdmin = async () => {
    if (isAdmin.value !== null) return  // уже проверяли

    try {
      const result = await api.get('/admin/check')
      isAdmin.value = result.isAdmin
    } catch {
      isAdmin.value = false
    }
  }

  const pause = () => api.post('/admin/pause')
  const resume = () => api.post('/admin/continue')
  const emerge = () => api.post('/admin/emerge')

  return { isAdmin, checkAdmin, pause, resume, emerge }
}
```

Endpoint `GET /api/admin/check` возвращает `{ isAdmin: true/false }` —
вызывает тот же `getChatMember`, что использует бот.

## 5.2 GET /api/admin/check

Добавить в `router.js`:

```js
router.get('/admin/check', auth, async (req, res) => {
  try {
    const member = await bot.getChatMember(queueChatId, req.tgUser.id)
    const isAdmin = ['administrator', 'creator'].includes(member?.status)
    res.json({ isAdmin })
  } catch {
    res.json({ isAdmin: false })
  }
})
```

## 5.3 features/admin/AdminPanel.vue

```vue
<script setup>
import { ref, onMounted, computed } from 'vue'
import { useAdmin } from '@/composables/useAdmin.js'
import { useQueue } from '@/composables/useQueue.js'
import AppButton from '@/shared/ui/AppButton.vue'

const { isAdmin, checkAdmin, pause, resume, emerge } = useAdmin()
const { state } = useQueue()

const loading = ref(false)
const result = ref(null)  // последний результат действия

onMounted(() => checkAdmin())

const isPaused = computed(() => state.paused)
const isEmergeActive = computed(() => state.emergeActive)
const hasActiveMatch = computed(() => {
  const m = state.queue[0]
  return m?.status === 'playing'
})

const handleAction = async (action) => {
  loading.value = true
  result.value = null
  try {
    const res = await action()
    result.value = { ok: res.ok !== false, reason: res.reason }
  } catch {
    result.value = { ok: false, reason: 'connection_error' }
  } finally {
    loading.value = false
  }
}

const errorMessages = {
  already_paused: 'Пауза уже активна',
  not_paused: 'Пауза не активна',
  admin_required: 'Требуются права администратора',
  connection_error: 'Ошибка соединения',
}

const resultText = computed(() => {
  if (!result.value) return null
  if (result.value.ok) return null
  return errorMessages[result.value.reason] || 'Не удалось выполнить действие'
})
</script>

<template>
  <!-- Панель не рендерится до завершения проверки прав -->
  <section v-if="isAdmin" class="admin-panel">

    <h2 class="admin-panel__title">Управление очередью</h2>

    <!-- Статус -->
    <div class="admin-panel__status">
      <span :class="['admin-panel__badge', isPaused ? 'admin-panel__badge--warn' : 'admin-panel__badge--ok']">
        {{ isPaused ? 'На паузе' : 'Активна' }}
      </span>
      <span v-if="isEmergeActive" class="admin-panel__badge admin-panel__badge--danger">
        Экстренная пауза
      </span>
    </div>

    <!-- Ошибка последнего действия -->
    <p v-if="resultText" class="admin-panel__error">{{ resultText }}</p>

    <!-- Действия -->
    <div class="admin-panel__actions">

      <!-- Пауза (только если не на паузе) -->
      <AppButton
        v-if="!isPaused"
        variant="ghost"
        :loading="loading"
        @click="handleAction(pause)"
      >
        Поставить на паузу
      </AppButton>

      <!-- Продолжить (если на паузе или emerge активен) -->
      <AppButton
        v-if="isPaused || isEmergeActive"
        variant="primary"
        :loading="loading"
        @click="handleAction(resume)"
      >
        Продолжить очередь
      </AppButton>

      <!-- Экстренная пауза (только если есть активный матч и нет других пауз) -->
      <AppButton
        v-if="hasActiveMatch && !isPaused && !isEmergeActive"
        variant="danger"
        :loading="loading"
        @click="handleAction(emerge)"
      >
        Экстренная пауза матча
      </AppButton>

    </div>

  </section>
</template>

<style lang="scss" scoped>
.admin-panel {
  border-top: 1px solid var(--color-secondary-bg);
  padding-top: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;

  &__title {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-hint);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  &__status {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  &__badge {
    font-size: 13px;
    padding: 4px 10px;
    border-radius: 20px;

    &--ok      { background: rgba(52, 199, 89, 0.2); color: #1a7a3a; }
    &--warn    { background: rgba(255, 204, 0, 0.2); color: #b8860b; }
    &--danger  { background: rgba(255, 59, 48, 0.2); color: #c0392b; }
  }

  &__error {
    font-size: 14px;
    color: #ff3b30;
  }

  &__actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
}
</style>
```

## 5.4 Логика кнопок

Таблица видимости кнопок:

| Состояние | Пауза | Продолжить | Экстренная пауза |
|-----------|-------|------------|-----------------|
| Нет паузы, нет матча | ✓ | — | — |
| Нет паузы, матч идёт | ✓ | — | ✓ |
| На паузе (обычная) | — | ✓ | — |
| Emerge активен | — | ✓ | — |
| На паузе + emerge | — | ✓ | — |

Это точно повторяет логику бота:
- `/pause` → недоступна если уже на паузе
- `/continue` → доступна при паузе или emerge
- `/emerge` → только если есть активный матч (status=playing), нет паузы, нет emerge

## 5.5 Отображение результата действий

После успешного действия SSE автоматически обновит `state.paused` / `state.emergeActive`,
поэтому кнопки перерисуются без дополнительной логики. Показывать toast-уведомление
об успехе избыточно — изменение статуса уже визуально подтверждает действие.

Показывать нужно только ошибки (поле `resultText`).

## 5.6 Подтверждение для опасных действий

Для "Экстренная пауза матча" и "Нет времени на игры" добавить confirm-диалог
через нативный Telegram `showPopup` если доступен, иначе `window.confirm`:

```js
const confirmAndAct = async (message, action) => {
  const tg = window.Telegram?.WebApp
  if (tg?.showPopup) {
    tg.showPopup(
      { message, buttons: [{ id: 'ok', text: 'Подтвердить' }, { type: 'cancel' }] },
      (buttonId) => { if (buttonId === 'ok') handleAction(action) }
    )
  } else {
    if (window.confirm(message)) handleAction(action)
  }
}
```

Использование:
```vue
@click="confirmAndAct('Экстренная пауза остановит текущий матч. Продолжить?', emerge)"
```

## 5.7 Кеширование проверки прав

Проверка `isAdmin` — singleton (module-level `ref`). Повторные вызовы `checkAdmin()`
не делают дополнительных запросов. При перемонтировании компонента (например,
при hot reload) повторного запроса нет.

Сброс кеша не нужен: права администратора не меняются в процессе работы приложения.

## 5.8 Управление списком игроков (PlayerManager)

Администратор может удалять игроков из реестра `knownPlayers` — например, если
человек уволился или его не нужно показывать в пикере.

### Компонент features/admin/PlayerManager.vue

```vue
<script setup>
import { ref, onMounted } from 'vue'
import { useApi } from '@/composables/useApi.js'
import { usePlayers } from '@/composables/usePlayers.js'
import PlayerAvatar from '@/shared/ui/PlayerAvatar.vue'
import AppButton from '@/shared/ui/AppButton.vue'

const api = useApi()
const { state, load } = usePlayers()

const deletingUsername = ref(null)  // username игрока, которого удаляем прямо сейчас

onMounted(() => load())

const confirmDelete = (username) => {
  const tg = window.Telegram?.WebApp
  const message = `Удалить ${username} из списка игроков?`

  if (tg?.showPopup) {
    tg.showPopup(
      { message, buttons: [{ id: 'ok', text: 'Удалить' }, { type: 'cancel' }] },
      (buttonId) => { if (buttonId === 'ok') deletePlayer(username) }
    )
  } else {
    if (window.confirm(message)) deletePlayer(username)
  }
}

const deletePlayer = async (username) => {
  deletingUsername.value = username
  try {
    await api.del(`/players/${username.replace('@', '')}`)
    // Обновить список: удалить локально без повторного запроса
    const idx = state.players.findIndex(p => p.username === username)
    if (idx !== -1) state.players.splice(idx, 1)
  } catch {
    // Ошибка — ничего не делаем, список остаётся как есть
  } finally {
    deletingUsername.value = null
  }
}
</script>

<template>
  <section class="player-manager">
    <h3 class="player-manager__title">Список игроков</h3>

    <p v-if="state.loading" class="player-manager__hint">Загрузка...</p>

    <p v-else-if="!state.players.length" class="player-manager__hint">
      Список пуст
    </p>

    <div v-else class="player-manager__list">
      <div
        v-for="p in state.players"
        :key="p.username"
        class="player-manager__row"
      >
        <PlayerAvatar :username="p.username" :size="36" />
        <div class="player-manager__info">
          <span class="player-manager__name">{{ p.displayName }}</span>
          <span class="player-manager__username">{{ p.username }}</span>
        </div>
        <button
          class="player-manager__delete"
          :disabled="deletingUsername === p.username"
          @click="confirmDelete(p.username)"
        >
          ✕
        </button>
      </div>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.player-manager {
  &__title {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-hint);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 10px;
  }

  &__hint {
    font-size: 14px;
    color: var(--color-hint);
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  &__row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 4px;
    border-radius: 8px;

    &:hover { background: var(--color-secondary-bg); }
  }

  &__info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
    overflow: hidden;
  }

  &__name {
    font-size: 14px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__username {
    font-size: 12px;
    color: var(--color-hint);
  }

  &__delete {
    border: none;
    background: none;
    color: var(--color-hint);
    font-size: 16px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
    flex-shrink: 0;

    &:hover { color: #ff3b30; background: rgba(255, 59, 48, 0.1); }
    &:disabled { opacity: 0.4; cursor: not-allowed; }
  }
}
</style>
```

### Подключение в AdminPanel.vue

```vue
<!-- В AdminPanel.vue — добавить после блока действий -->
<PlayerManager />
```

```js
import PlayerManager from './PlayerManager.vue'
```

Компонент отображается только внутри `AdminPanel`, которая показывается только
администраторам — дополнительной проверки прав не нужно.

## Критерии готовности этапа

- [x] AdminPanel не отображается для обычных пользователей
- [x] AdminPanel отображается только для администраторов чата
- [x] Кнопка "Поставить на паузу" меняет статус и скрывается
- [x] Кнопка "Продолжить" снимает паузу и обновляет статус через SSE
- [x] Кнопка "Экстренная пауза" показывается только при активном матче
- [x] Экстренная пауза и её снятие работают корректно (как в боте)
- [x] Для опасных действий показывается confirm-диалог
- [x] Ошибки (403, уже на паузе) отображаются понятным текстом
- [x] После действий SSE обновляет состояние без перезагрузки
- [x] PlayerManager показывает список игроков с аватарами
- [x] Удаление игрока запрашивает подтверждение и убирает его из списка
- [x] Удалённый игрок пропадает из пикера в DirectMatchModal
