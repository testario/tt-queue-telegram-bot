<script setup>
import { computed } from 'vue'
import { useQueue } from '@/composables/useQueue.js'
import MatchCard from './MatchCard.vue'
import SearchPanel from '@/features/search/SearchPanel.vue'
import PlayedView from '@/features/played/PlayedView.vue'

const { state } = useQueue()

const currentMatch = computed(() => state.queue[0] ?? null)
const waitingMatches = computed(() => state.queue.slice(1))
</script>

<template>
  <div class="queue-view">

    <!-- Загрузка -->
    <div v-if="state.loading" class="queue-view__loader">
      Загрузка...
    </div>

    <!-- Ошибка соединения -->
    <div v-else-if="state.error" class="queue-view__error">
      Нет соединения. Переподключаемся...
    </div>

    <template v-else>

      <!-- Пауза-баннер -->
      <div v-if="state.paused" class="banner banner--warn">
        Очередь на паузе
      </div>

      <!-- Активный матч -->
      <section v-if="currentMatch" class="section">
        <MatchCard :match="currentMatch" :is-current="true" />
      </section>

      <!-- Нет матчей -->
      <section v-else class="section section--empty">
        <div class="section__empty-icon">TT</div>
        <h2>Очередь пуста</h2>
        <p>Самое время найти соперника.</p>
      </section>

      <!-- Ожидающие матчи -->
      <section v-if="waitingMatches.length" class="section">
        <h2 class="section__title">Следующие</h2>
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

    </template>
  </div>
</template>

<style lang="scss" scoped>
.queue-view {
  display: flex;
  flex-direction: column;
  gap: 14px;

  &__loader,
  &__error {
    text-align: center;
    padding: 32px 0;
    color: var(--color-hint);
    font-size: 15px;
  }

  &__error {
    color: #ff3b30;
  }
}

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;

  &__title {
    font-size: 15px;
    font-weight: 800;
    color: var(--color-hint);
  }

  &--empty {
    align-items: center;
    padding: 28px 16px;
    border-radius: var(--radius-card);
    background: var(--color-blue-soft);
    color: var(--color-text-secondary);
    text-align: center;

    h2 {
      color: var(--color-link);
      font-size: 16px;
      font-weight: 900;
    }

    p {
      font-size: 13px;
      font-weight: 600;
    }
  }

  &__empty-icon {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 999px;
    background: var(--color-empty-icon-bg);
    color: var(--color-link);
    font-size: 14px;
    font-weight: 900;
  }
}

.banner {
  padding: 12px 14px;
  border-radius: 18px;
  font-size: 14px;
  font-weight: 800;
  text-align: center;

  &--warn {
    background: color-mix(in srgb, var(--color-warning), transparent 84%);
    color: var(--color-warning);
  }
}
</style>
