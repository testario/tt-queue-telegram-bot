# Этап 3: Отображение очереди (read-only)

## Цель

Реализовать главный экран с очередью, обратным таймером для активного матча,
списком ищущих игроков и списком уже отыгравших. На этом этапе — только чтение,
никаких действий пользователя.

## 3.1 QueueView.vue

Главный экран приложения. Структура:
1. Блок активного матча (если есть) с таймером
2. Список ожидающих матчей
3. Список ищущих игроков
4. Переключатель "Уже отыграли"

```vue
<script setup>
import { computed } from 'vue'
import { useQueue } from '@/composables/useQueue.js'
import { useTelegram } from '@/composables/useTelegram.js'
import MatchCard from './MatchCard.vue'
import SearchPanel from '@/features/search/SearchPanel.vue'
import PlayedView from '@/features/played/PlayedView.vue'

const { state } = useQueue()
const { player } = useTelegram()

const currentMatch = computed(() => state.queue[0] ?? null)
const waitingMatches = computed(() => state.queue.slice(1))
const isCurrentPlaying = computed(() =>
  currentMatch.value?.status === 'playing'
)
</script>

<template>
  <div class="queue-view">

    <!-- Пауза-баннер -->
    <div v-if="state.paused" class="banner banner--warn">
      Очередь на паузе
    </div>

    <!-- Активный матч -->
    <section v-if="currentMatch" class="section">
      <h2 class="section__title">{{ isCurrentPlaying ? 'Играют сейчас' : 'Следующая пара' }}</h2>
      <MatchCard :match="currentMatch" :is-current="true" />
    </section>

    <!-- Нет матчей -->
    <section v-else class="section section--empty">
      <p>Очередь пуста</p>
    </section>

    <!-- Ожидающие матчи -->
    <section v-if="waitingMatches.length" class="section">
      <h2 class="section__title">Очередь</h2>
      <MatchCard
        v-for="(match, i) in waitingMatches"
        :key="`${match.player1}-${match.player2}`"
        :match="match"
        :position="i + 2"
      />
    </section>

    <!-- Ищут соперника -->
    <SearchPanel />

    <!-- Уже отыграли -->
    <PlayedView />

  </div>
</template>

<style lang="scss" scoped>
.queue-view {
  padding-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.section {
  &__title {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-hint);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }

  &--empty {
    text-align: center;
    color: var(--color-hint);
    padding: 32px 0;
  }
}

.banner {
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 14px;
  text-align: center;

  &--warn {
    background: rgba(255, 204, 0, 0.2);
    color: #b8860b;
  }
}
</style>
```

## 3.2 MatchCard.vue

Карточка одного матча. Для текущего матча показывает таймер обратного отсчёта.

```vue
<script setup>
import { computed } from 'vue'
import CountdownTimer from '@/shared/ui/CountdownTimer.vue'
import PlayerTag from '@/shared/ui/PlayerTag.vue'
import { formatTime } from '@/shared/lib/formatTime.js'

const props = defineProps({
  match: {
    type: Object,  // { player1, player2, startDate, endDate, status }
    required: true,
  },
  isCurrent: {
    type: Boolean,
    default: false,
  },
  position: {
    type: Number,
    default: null,
  },
})

const startTime = computed(() => formatTime(props.match.startDate))
const endTime = computed(() => formatTime(props.match.endDate))
const isPlaying = computed(() => props.match.status === 'playing')
</script>

<template>
  <div :class="['match-card', { 'match-card--current': isCurrent, 'match-card--playing': isPlaying }]">

    <!-- Позиция в очереди -->
    <div v-if="position" class="match-card__position">#{{ position }}</div>

    <!-- Игроки -->
    <div class="match-card__players">
      <PlayerTag :name="match.player1" />
      <span class="match-card__vs">vs</span>
      <PlayerTag :name="match.player2" />
    </div>

    <!-- Таймер для текущего матча -->
    <div v-if="isCurrent && isPlaying" class="match-card__timer">
      <CountdownTimer :end-date="match.endDate" />
    </div>

    <!-- Время начала/окончания -->
    <div v-else class="match-card__time">
      {{ startTime }} — {{ endTime }}
    </div>

  </div>
</template>

<style lang="scss" scoped>
.match-card {
  background: var(--color-secondary-bg);
  border-radius: 12px;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;

  &--current {
    background: var(--color-button);
    color: var(--color-button-text);
  }

  &__players {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 16px;
    font-weight: 500;
  }

  &__vs {
    color: inherit;
    opacity: 0.6;
    font-size: 13px;
  }

  &__position {
    font-size: 12px;
    opacity: 0.6;
  }

  &__timer {
    font-size: 28px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    letter-spacing: 1px;
  }

  &__time {
    font-size: 14px;
    opacity: 0.7;
  }
}
</style>
```

## 3.3 shared/ui/CountdownTimer.vue

Компонент обратного таймера. Тикает каждую секунду, использует `requestAnimationFrame`
через `setInterval`. Автоматически останавливается при `endDate` в прошлом.

```vue
<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { formatCountdown } from '@/shared/lib/formatTime.js'

const props = defineProps({
  endDate: {
    type: Date,
    required: true,
  },
})

const display = ref('00:00')
let interval = null

const tick = () => {
  const remaining = props.endDate.getTime() - Date.now()
  display.value = formatCountdown(remaining)
  if (remaining <= 0) clearInterval(interval)
}

onMounted(() => {
  tick()
  interval = setInterval(tick, 1000)
})

onUnmounted(() => clearInterval(interval))

watch(() => props.endDate, () => {
  clearInterval(interval)
  tick()
  interval = setInterval(tick, 1000)
})
</script>

<template>
  <span>{{ display }}</span>
</template>
```

## 3.4 shared/ui/PlayerTag.vue

```vue
<script setup>
defineProps({
  name: String,  // '@username' или 'username'
})
</script>

<template>
  <span class="player-tag">{{ name }}</span>
</template>

<style lang="scss" scoped>
.player-tag {
  font-weight: 500;
  word-break: break-word;
}
</style>
```

## 3.5 features/played/PlayedView.vue

```vue
<script setup>
import { useQueue } from '@/composables/useQueue.js'
import PlayerTag from '@/shared/ui/PlayerTag.vue'

const { state } = useQueue()
</script>

<template>
  <section class="played">
    <h2 class="played__title">Уже отыграли</h2>

    <p v-if="!state.played.length" class="played__empty">
      Ещё никто не играл — самое время встать в очередь
    </p>

    <ul v-else class="played__list">
      <li v-for="player in state.played" :key="player">
        <PlayerTag :name="player" />
      </li>
    </ul>
  </section>
</template>

<style lang="scss" scoped>
.played {
  &__title {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-hint);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }

  &__empty {
    color: var(--color-hint);
    font-size: 14px;
  }

  &__list {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
}
</style>
```

## 3.6 Состояния загрузки и ошибок

В `QueueView.vue` добавить обработку `state.loading` и `state.error`:

```vue
<template>
  <div class="queue-view">
    <div v-if="state.loading" class="queue-view__loader">
      Загрузка...
    </div>
    <div v-else-if="state.error" class="queue-view__error">
      Нет соединения. Переподключаемся...
    </div>
    <template v-else>
      <!-- основной контент -->
    </template>
  </div>
</template>
```

## Критерии готовности этапа

- [x] Открытие Mini App показывает текущую очередь без лишних действий
- [x] Таймер тикает в реальном времени для активного матча
- [x] При изменении состояния очереди (через SSE) экран обновляется без перезагрузки
- [x] Список ищущих игроков отображается корректно
- [x] Список отыгравших отображается корректно
- [x] Состояние паузы отображается баннером
- [ ] Экран выглядит корректно в светлой и тёмной теме Telegram
