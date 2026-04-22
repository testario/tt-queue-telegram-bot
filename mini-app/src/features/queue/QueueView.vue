<script setup>
import { computed } from 'vue'
import { useQueue } from '@/composables/useQueue.js'
import MatchCard from './MatchCard.vue'
import SearchPanel from '@/features/search/SearchPanel.vue'
import PlayedView from '@/features/played/PlayedView.vue'
import InviteCard from '@/features/direct-match/InviteCard.vue'

const { state } = useQueue()

const currentMatch = computed(() => state.queue[0] ?? null)
const waitingMatches = computed(() => state.queue.slice(1))
const isCurrentPlaying = computed(() =>
  currentMatch.value?.status === 'playing'
)
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

      <!-- Входящее приглашение -->
      <InviteCard />

      <!-- Ищут соперника -->
      <SearchPanel />

      <!-- Уже отыграли -->
      <PlayedView />

    </template>
  </div>
</template>

<style lang="scss" scoped>
.queue-view {
  padding-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 24px;

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
