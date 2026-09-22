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
    :aria-busy="loading"
  >
    <span v-if="loading" class="btn__spinner" aria-hidden="true" />
    <span class="btn__content"><slot /></span>
  </button>
</template>

<style lang="scss" scoped>
.btn {
  position: relative;
  width: 100%;
  min-height: 52px;
  padding: 0 16px;
  border: none;
  border-radius: var(--radius-control);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 850;
  cursor: pointer;
  transition: opacity 0.15s;

  &:disabled { opacity: 0.5; cursor: not-allowed; }
  // Контент гасим прозрачностью, а не убираем из разметки и не visibility:
  // hidden — ширина/высота кнопки не скачут, когда на её место встаёт
  // спиннер, а доступное имя кнопки для скринридера не теряется (loading
  // всегда идёт вместе с disabled, поэтому свой opacity здесь не нужен —
  // .btn:disabled уже его задаёт).
  &--loading .btn__content { opacity: 0; }

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

.btn__content {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: opacity 0.15s;
}

.btn__spinner {
  position: absolute;
  // inset: 0 + margin: auto центрирует спиннер сам по себе, а не через
  // align-items/justify-content родителя — не уедет в угол, если у .btn
  // когда-нибудь поменяют выключение контента по осям.
  inset: 0;
  margin: auto;
  width: 20px;
  height: 20px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: btn-spin 0.6s linear infinite;
}

@keyframes btn-spin {
  to { transform: rotate(360deg); }
}
</style>
