<script setup>
import AppIcon from './AppIcon.vue'

defineProps({
  activeTab: {
    type: String,
    required: true,
  },
  tabs: {
    type: Array,
    required: true,
  },
})

const emit = defineEmits(['change'])
</script>

<template>
  <nav
    class="bottom-nav"
    :style="{ '--tabs-count': tabs.length }"
    aria-label="Основная навигация"
  >
    <button
      v-for="tab in tabs"
      :key="tab.id"
      :class="['bottom-nav__item', { 'bottom-nav__item--active': activeTab === tab.id }]"
      type="button"
      @click="emit('change', tab.id)"
    >
      <AppIcon :name="tab.icon" />
      <span>{{ tab.label }}</span>
    </button>
  </nav>
</template>

<style lang="scss" scoped>
.bottom-nav {
  display: grid;
  grid-template-columns: repeat(var(--tabs-count), minmax(0, 1fr));
  gap: 2px;
  height: 62px;
  padding: 4px;
  border: 1px solid var(--color-border);
  border-radius: 36px;
  background: var(--color-surface);
  box-shadow: 0 8px 20px var(--color-nav-shadow);

  &__item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    min-width: 0;
    border: 0;
    border-radius: 26px;
    background: transparent;
    color: var(--color-muted);
    font: inherit;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    cursor: pointer;

    svg {
      width: 18px;
      height: 18px;
    }

    &--active {
      background: var(--color-button);
      color: var(--color-button-text);
    }
  }
}
</style>
