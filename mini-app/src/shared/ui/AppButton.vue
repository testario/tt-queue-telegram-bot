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
  padding: 12px 16px;
  border: none;
  border-radius: 10px;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.15s;

  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &--loading { opacity: 0.7; }

  &--primary {
    background: var(--color-button);
    color: var(--color-button-text);
  }

  &--danger {
    background: #ff3b30;
    color: #ffffff;
  }

  &--ghost {
    background: var(--color-secondary-bg);
    color: var(--color-text);
  }
}
</style>
