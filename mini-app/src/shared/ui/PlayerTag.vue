<script setup>
defineProps({
  name: {
    type: String,
    required: true,
  },
})
</script>

<template>
  <span class="player-tag">{{ name }}</span>
</template>

<style lang="scss" scoped>
.player-tag {
  display: inline-block;
  max-width: 100%;
  padding: 5px 9px;
  border-radius: 999px;
  background: var(--color-surface-soft);
  color: var(--color-link);
  font-size: 14px;
  font-weight: 850;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
