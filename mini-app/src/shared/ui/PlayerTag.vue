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
  padding: 2px 8px;
  border-radius: 12px;
  background: var(--color-secondary-bg);
  color: var(--color-link);
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
}
</style>
