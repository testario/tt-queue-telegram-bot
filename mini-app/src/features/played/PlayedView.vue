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
