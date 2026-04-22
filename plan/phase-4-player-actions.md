# Этап 4: Действия игрока

## Цель

Реализовать все действия, доступные обычному игроку:
- Встать в поиск соперника
- Отменить свой поиск
- Принять соперника из поиска ("Сыграть с ним")
- Отменить свой матч ("Нет времени")
- Прямое приглашение конкретного соперника
- Принять/отклонить/отменить прямое приглашение

## 4.1 Определение контекста текущего игрока

Прежде чем рендерить кнопки, нужно понять, в каком состоянии находится текущий пользователь.
Это вычисляемые свойства на основе `useQueue().state` и `useTelegram().player`.

```js
// В компонентах, где нужен контекст:
import { computed } from 'vue'
import { useQueue } from '@/composables/useQueue.js'
import { useTelegram } from '@/composables/useTelegram.js'

const { state } = useQueue()
const { player } = useTelegram()

const isSearching = computed(() =>
  player && state.searching.includes(player)
)

const isInQueue = computed(() =>
  player && state.queue.some(m => m.player1 === player || m.player2 === player)
)

const isPlayed = computed(() =>
  player && state.played.includes(player)
)

const isInCurrentMatch = computed(() => {
  const m = state.queue[0]
  return m && (m.player1 === player || m.player2 === player)
})

const playerStatus = computed(() => {
  if (!player) return 'no_username'
  if (isSearching.value) return 'searching'
  if (isInCurrentMatch.value) return 'playing'
  if (isInQueue.value) return 'waiting'
  if (isPlayed.value) return 'played'
  return 'idle'
})
```

## 4.2 features/search/SearchPanel.vue

Панель управляет состоянием текущего игрока в поиске.
Отображает список ищущих и нужную кнопку в зависимости от `playerStatus`.

```vue
<script setup>
import { computed, ref } from 'vue'
import { useQueue } from '@/composables/useQueue.js'
import { useTelegram } from '@/composables/useTelegram.js'
import { useApi } from '@/composables/useApi.js'
import AppButton from '@/shared/ui/AppButton.vue'
import PlayerTag from '@/shared/ui/PlayerTag.vue'
import DirectMatchModal from '@/features/direct-match/DirectMatchModal.vue'

const { state } = useQueue()
const { player } = useTelegram()
const api = useApi()

const loading = ref(false)
const showDirectModal = ref(false)

const isSearching = computed(() => player && state.searching.includes(player))
const isInQueue = computed(() =>
  player && state.queue.some(m => m.player1 === player || m.player2 === player)
)
const isInCurrentMatch = computed(() => {
  const m = state.queue[0]
  return m && (m.player1 === player || m.player2 === player)
})
const isPlayed = computed(() => player && state.played.includes(player))
const isIdle = computed(
  () => !isSearching.value && !isInQueue.value && !isPlayed.value && !!player
)

// Список ищущих без себя (чтобы показать кнопку "Сыграть с ним")
const othersSearching = computed(() =>
  state.searching.filter(p => p !== player)
)

const registerSearch = async () => {
  loading.value = true
  try {
    await api.post('/search')
  } finally {
    loading.value = false
  }
}

const cancelSearch = async () => {
  loading.value = true
  try {
    await api.del('/search')
  } finally {
    loading.value = false
  }
}

const cancelMatch = async () => {
  loading.value = true
  try {
    await api.del('/match')
  } finally {
    loading.value = false
  }
}

const playWith = async (opponent) => {
  loading.value = true
  try {
    // opponent — тот, кто уже в поиске; player — текущий пользователь
    await api.post('/match', { opponent })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="search-panel">

    <!-- Ищут соперника -->
    <div v-if="state.searching.length" class="search-panel__searching">
      <h2 class="search-panel__title">Ищут соперника</h2>

      <div
        v-for="searcher in state.searching"
        :key="searcher"
        class="search-panel__row"
      >
        <PlayerTag :name="searcher" />

        <!-- Кнопка "Сыграть с ним" — только для других игроков, и только если ты idle -->
        <AppButton
          v-if="searcher !== player && isIdle"
          variant="primary"
          :loading="loading"
          class="search-panel__play-btn"
          @click="playWith(searcher)"
        >
          Сыграть с ним
        </AppButton>
      </div>
    </div>

    <!-- Действия текущего пользователя -->
    <div class="search-panel__actions">

      <!-- Нет username -->
      <p v-if="!player" class="search-panel__hint">
        Установите Telegram username в настройках, чтобы участвовать в очереди
      </p>

      <!-- Уже играл -->
      <p v-else-if="isPlayed" class="search-panel__hint">
        Вы уже играли в этой части дня
      </p>

      <!-- Ищет соперника -->
      <template v-else-if="isSearching">
        <p class="search-panel__hint">Вы в поиске соперника</p>
        <AppButton variant="ghost" :loading="loading" @click="cancelSearch">
          Отменить поиск
        </AppButton>
      </template>

      <!-- В очереди (ждёт) -->
      <p v-else-if="isInQueue && !isInCurrentMatch" class="search-panel__hint">
        Вы в очереди — ожидайте своей пары
      </p>

      <!-- В текущем матче -->
      <template v-else-if="isInCurrentMatch">
        <p class="search-panel__hint">Вы играете прямо сейчас!</p>
        <AppButton variant="danger" :loading="loading" @click="cancelMatch">
          Нет времени на игры
        </AppButton>
      </template>

      <!-- Свободен -->
      <template v-else-if="isIdle">
        <AppButton variant="primary" :loading="loading" @click="registerSearch">
          Ищу соперника
        </AppButton>
        <AppButton variant="ghost" @click="showDirectModal = true">
          Пригласить конкретного игрока
        </AppButton>
      </template>

    </div>

    <!-- Модал прямого приглашения -->
    <DirectMatchModal v-if="showDirectModal" @close="showDirectModal = false" />

  </section>
</template>

<style lang="scss" scoped>
.search-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;

  &__title {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-hint);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }

  &__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 0;
    border-bottom: 1px solid var(--color-secondary-bg);

    &:last-child { border-bottom: none; }
  }

  &__play-btn {
    width: auto;
    padding: 8px 12px;
    font-size: 14px;
  }

  &__hint {
    font-size: 14px;
    color: var(--color-hint);
    text-align: center;
    padding: 4px 0;
  }

  &__actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
}
</style>
```

## 4.3 features/direct-match/DirectMatchModal.vue

Модал для прямого приглашения. Содержит:
1. Поле поиска по имени/username (фильтр)
2. Список известных игроков с аватарами — кликабельные строки
3. Если нужного игрока нет в списке — ввод username вручную

```vue
<script setup>
import { ref, computed, onMounted } from 'vue'
import { useApi } from '@/composables/useApi.js'
import { usePlayers } from '@/composables/usePlayers.js'
import { useQueue } from '@/composables/useQueue.js'
import { useTelegram } from '@/composables/useTelegram.js'
import AppButton from '@/shared/ui/AppButton.vue'
import PlayerAvatar from '@/shared/ui/PlayerAvatar.vue'

const emit = defineEmits(['close'])
const api = useApi()
const { state: playersState, load } = usePlayers()
const { state: queueState } = useQueue()
const { player: currentPlayer } = useTelegram()

const search = ref('')
const manualInput = ref('')
const selected = ref(null)   // { username, displayName } — выбранный из списка
const loading = ref(false)
const error = ref(null)

onMounted(() => load())

// Исключаем себя и тех, кто уже в очереди/поиске/играл
const unavailable = computed(() => new Set([
  currentPlayer,
  ...queueState.queue.flatMap(m => [m.player1, m.player2]),
  ...queueState.played,
]))

// Фильтрация по строке поиска
const filteredPlayers = computed(() => {
  const q = search.value.toLowerCase().trim()
  return playersState.players.filter(p => {
    if (unavailable.value.has(p.username)) return false
    if (!q) return true
    return (
      p.username.toLowerCase().includes(q) ||
      p.displayName.toLowerCase().includes(q)
    )
  })
})

const selectPlayer = (player) => {
  selected.value = player
  manualInput.value = ''
  error.value = null
}

// Итоговый username для приглашения: из списка или из ручного ввода
const resolvedOpponent = computed(() => {
  if (selected.value) return selected.value.username
  const raw = manualInput.value.trim()
  if (!raw) return null
  return raw.startsWith('@') ? raw : `@${raw}`
})

const submit = async () => {
  const opponent = resolvedOpponent.value
  if (!opponent) return

  loading.value = true
  error.value = null

  try {
    const result = await api.post('/direct', { opponent })
    if (result.ok) {
      emit('close')
    } else {
      error.value = reasonToText(result.reason)
    }
  } catch {
    error.value = 'Ошибка соединения'
  } finally {
    loading.value = false
  }
}

const reasonToText = (reason) => ({
  already_played: 'Этот игрок уже играл сегодня',
  already_in_queue: 'Этот игрок уже в очереди',
  same_player: 'Нельзя пригласить себя',
  player1_not_searching: 'Игрок не в поиске',
}[reason] ?? 'Не удалось отправить приглашение')
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal">
      <h3 class="modal__title">Пригласить игрока</h3>

      <!-- Поиск по списку -->
      <input
        v-model="search"
        class="modal__search"
        type="text"
        placeholder="Поиск по имени или @username"
        autofocus
      />

      <!-- Список известных игроков -->
      <div class="modal__list">
        <div v-if="playersState.loading" class="modal__hint">Загрузка...</div>

        <div v-else-if="!filteredPlayers.length" class="modal__hint">
          Никого не найдено
        </div>

        <button
          v-for="p in filteredPlayers"
          :key="p.username"
          :class="['modal__player', { 'modal__player--selected': selected?.username === p.username }]"
          @click="selectPlayer(p)"
        >
          <PlayerAvatar :username="p.username" :size="40" />
          <div class="modal__player-info">
            <span class="modal__player-name">{{ p.displayName }}</span>
            <span class="modal__player-username">{{ p.username }}</span>
          </div>
        </button>
      </div>

      <!-- Разделитель + ручной ввод -->
      <div class="modal__divider">или введите username вручную</div>
      <input
        v-model="manualInput"
        class="modal__input"
        type="text"
        placeholder="@username"
        @input="selected = null"
        @keydown.enter="submit"
      />

      <p v-if="error" class="modal__error">{{ error }}</p>

      <div class="modal__buttons">
        <AppButton :loading="loading" :disabled="!resolvedOpponent" @click="submit">
          Пригласить
        </AppButton>
        <AppButton variant="ghost" @click="$emit('close')">
          Отмена
        </AppButton>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-end;
  z-index: 100;
}

.modal {
  background: var(--color-bg);
  width: 100%;
  max-height: 80vh;
  border-radius: 16px 16px 0 0;
  padding: 24px 16px 32px;
  display: flex;
  flex-direction: column;
  gap: 12px;

  &__title {
    font-size: 18px;
    font-weight: 600;
    text-align: center;
  }

  &__search, &__input {
    width: 100%;
    padding: 10px 14px;
    border: 1.5px solid var(--color-secondary-bg);
    border-radius: 10px;
    background: var(--color-secondary-bg);
    color: var(--color-text);
    font-size: 15px;
    outline: none;

    &:focus { border-color: var(--color-button); }
  }

  &__list {
    overflow-y: auto;
    max-height: 280px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  &__player {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    border-radius: 10px;
    border: none;
    background: transparent;
    cursor: pointer;
    text-align: left;
    transition: background 0.1s;

    &:hover, &--selected {
      background: var(--color-secondary-bg);
    }

    &--selected {
      outline: 2px solid var(--color-button);
    }
  }

  &__player-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;
  }

  &__player-name {
    font-size: 15px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__player-username {
    font-size: 13px;
    color: var(--color-hint);
  }

  &__hint {
    color: var(--color-hint);
    font-size: 14px;
    text-align: center;
    padding: 16px 0;
  }

  &__divider {
    font-size: 12px;
    color: var(--color-hint);
    text-align: center;
    position: relative;

    &::before, &::after {
      content: '';
      position: absolute;
      top: 50%;
      width: 28%;
      height: 1px;
      background: var(--color-secondary-bg);
    }
    &::before { left: 0; }
    &::after { right: 0; }
  }

  &__error {
    font-size: 14px;
    color: #ff3b30;
    text-align: center;
  }

  &__buttons {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
}
</style>
```

## 4.4 features/direct-match/InviteCard.vue

Карточка входящего прямого приглашения. Отображается только если текущий игрок
является `invited` в каком-то pending-приглашении.

Так как бот не хранит pending-приглашения в `QueueState`, нужно добавить
в ответ `/api/state` поле `pendingInvites`:

```js
// В router.js, GET /api/state
{
  ...existingState,
  pendingInvites: context.directMatch.getPendingInvites(),  // нужно реализовать хранение
}
```

**Альтернативный подход (проще):** Pending-приглашения хранить в памяти
webapp-интерфейса отдельно от доменного слоя — Map `player → invite`.
При `/api/direct` добавляем, при accept/decline/cancel — удаляем.

```vue
<script setup>
import { computed } from 'vue'
import { useQueue } from '@/composables/useQueue.js'
import { useTelegram } from '@/composables/useTelegram.js'
import { useApi } from '@/composables/useApi.js'
import AppButton from '@/shared/ui/AppButton.vue'

const { state } = useQueue()
const { player } = useTelegram()
const api = useApi()

// pendingInvites приходит в state из /api/events или /api/state
const myInvite = computed(() =>
  state.pendingInvites?.find(inv => inv.opponent === player) ?? null
)

const accept = () => api.post('/direct/accept', { player: myInvite.value.player })
const decline = () => api.post('/direct/decline', { player: myInvite.value.player })
</script>

<template>
  <div v-if="myInvite" class="invite-card">
    <p class="invite-card__text">
      {{ myInvite.player }} приглашает вас на игру
    </p>
    <div class="invite-card__actions">
      <AppButton @click="accept">Принять</AppButton>
      <AppButton variant="ghost" @click="decline">Отказаться</AppButton>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.invite-card {
  background: var(--color-secondary-bg);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;

  &__text {
    font-size: 16px;
    text-align: center;
  }

  &__actions {
    display: flex;
    gap: 8px;

    > * { flex: 1; }
  }
}
</style>
```

## 4.5 Хранение pending-приглашений на сервере

В `src/interfaces/webapp/router.js` добавить Map для pending-приглашений:

```js
const pendingInvites = new Map()
// ключ: player (кто пригласил), значение: { player, opponent, createdAt }

// POST /api/direct
router.post('/direct', auth, async (req, res) => {
  const { opponent } = req.body
  const result = await context.directMatch.execute(req.player, opponent)
  if (result.ok) {
    pendingInvites.set(req.player, {
      player: req.player,
      opponent,
      createdAt: Date.now(),
    })
    sseManager.broadcast('state_update', await buildStatePayload())
  }
  res.json({ ok: result.ok, reason: result.reason })
})

// POST /api/direct/accept — удаляем приглашение
// POST /api/direct/decline — удаляем приглашение
// POST /api/direct/cancel — удаляем приглашение

const buildStatePayload = async () => {
  const state = await context.repository.get()
  return {
    queue: state.queue,
    searching: state.searching,
    played: state.played,
    paused: isPauseModeEnabled(queueChatId),
    pendingInvites: Array.from(pendingInvites.values()),
  }
}
```

## 4.6 Добавление InviteCard в QueueView

```vue
<!-- В QueueView.vue — перед SearchPanel -->
<InviteCard />
```

## Критерии готовности этапа

- [x] Кнопка "Ищу соперника" добавляет игрока в поиск и исчезает
- [x] Игрок в поиске видит кнопку "Отменить поиск"
- [x] Кнопка "Сыграть с ним" у каждого ищущего игрока (кроме себя) создаёт матч
- [x] Игрок в активном матче видит кнопку "Нет времени"
- [x] Форма прямого приглашения открывается и отправляет запрос
- [x] Приглашённый игрок видит InviteCard и может принять/отклонить
- [x] Автор приглашения может его отменить
- [x] Все изменения отражаются через SSE без перезагрузки
- [x] Ошибки (уже играл, не в поиске и т.д.) показываются пользователю понятно
