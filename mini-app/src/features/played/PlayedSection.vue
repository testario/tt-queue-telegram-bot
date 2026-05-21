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
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);

  &__title {
    font-size: 15px;
    font-weight: 800;
    color: var(--color-hint);
    margin-bottom: 8px;
  }

  &__empty {
    color: var(--color-hint);
    font-size: 14px;
    font-weight: 600;
  }

  &__list {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
}
</style>
