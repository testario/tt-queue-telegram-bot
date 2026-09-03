<script setup>
import { ref } from 'vue'

defineProps({
  ariaLabel: {
    type: String,
    required: true,
  },
  contentClass: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['close'])

const closing = ref(false)

const startClose = () => {
  if (closing.value) return
  closing.value = true
}

const onBackdropAnimEnd = (e) => {
  if (closing.value && e.animationName.includes('modal-backdrop-out')) {
    emit('close')
  }
}

defineExpose({ startClose })
</script>

<template>
  <div :class="['app-modal', { 'app-modal--closing': closing }]">
    <div class="app-modal__backdrop" @click="startClose" @animationend="onBackdropAnimEnd"></div>
    <div class="app-modal__sheet-layer">
      <section
        :class="['app-modal__sheet', contentClass]"
        :aria-label="ariaLabel"
        aria-modal="true"
        role="dialog"
      >
        <slot :close="startClose" />
      </section>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.app-modal {
  position: fixed;
  inset: 0;
  z-index: 100;
  pointer-events: none;
}

.app-modal__backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  pointer-events: auto;
  animation: modal-backdrop-in 0.22s ease forwards;
}

.app-modal--closing .app-modal__backdrop {
  animation: modal-backdrop-out 0.22s ease forwards;
}

.app-modal__sheet-layer {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 16px 16px 0;
  pointer-events: none;
}

.app-modal__sheet {
  width: min(100%, 430px);
  max-height: 80vh;
  padding: 18px 18px calc(18px + env(safe-area-inset-bottom, 0px));
  border: 1px solid var(--color-border);
  border-radius: 28px 28px 0 0;
  background: var(--color-surface);
  box-shadow: 0 -14px 30px var(--color-card-shadow);
  display: flex;
  flex-direction: column;
  backface-visibility: hidden;
  pointer-events: auto;
  will-change: transform;
  animation: modal-sheet-in 0.26s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
}

.app-modal--closing .app-modal__sheet {
  animation: modal-sheet-out 0.24s cubic-bezier(0.4, 0, 1, 1) forwards;
}

@keyframes modal-backdrop-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@keyframes modal-backdrop-out {
  from { opacity: 1; }
  to   { opacity: 0; }
}

@keyframes modal-sheet-in {
  from { transform: translate3d(0, 100%, 0); }
  to   { transform: translate3d(0, 0, 0); }
}

@keyframes modal-sheet-out {
  from { transform: translate3d(0, 0, 0); }
  to   { transform: translate3d(0, 100%, 0); }
}
</style>