<script setup>
defineProps({
  variant: {
    type: String,
    default: 'primary',
    // 'primary' | 'danger' | 'ghost'
  },
  disabled: Boolean,
  loading: Boolean,
})
</script>

<template>
  <button
    :class="['btn', `btn--${variant}`, { 'btn--loading': loading }]"
    :disabled="disabled || loading"
  >
    <slot />
  </button>
</template>

<style lang="scss" scoped>
.btn {
  width: 100%;
  min-height: 52px;
  padding: 0 16px;
  border: none;
  border-radius: var(--radius-control);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 850;
  cursor: pointer;
  transition: opacity 0.15s;

  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &--loading { opacity: 0.7; }

  &--primary {
    background: var(--color-button);
    color: var(--color-button-text);
  }

  &--danger {
    background: var(--color-danger);
    color: #ffffff;
  }

  &--ghost {
    background: var(--color-surface-soft);
    color: var(--color-text);
  }
}
</style>
