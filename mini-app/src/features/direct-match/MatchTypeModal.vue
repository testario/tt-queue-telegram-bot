<script setup>
import AppButton from '@/shared/ui/AppButton.vue'
import AppModal from '@/shared/ui/AppModal.vue'

defineProps({
  standardAvailable: Boolean,
  tournamentAvailable: Boolean,
})

const emit = defineEmits(['select', 'close'])

const select = (type) => {
  emit('select', type)
  emit('close')
}
</script>

<template>
  <AppModal aria-label="Выбрать тип игры" content-class="match-type-modal" @close="$emit('close')" v-slot="{ close }">
    <h3 class="match-type-modal__title">Какую игру сыграем?</h3>

    <AppButton :disabled="!standardAvailable" @click="select('standard')">
      Обычная игра
    </AppButton>

    <AppButton
      variant="ghost"
      :disabled="!tournamentAvailable"
      @click="select('tournament')"
    >
      Турнирная игра
    </AppButton>

    <p v-if="!standardAvailable && !tournamentAvailable" class="match-type-modal__hint">
      Сейчас этого игрока нельзя пригласить
    </p>
    <p v-else-if="!standardAvailable" class="match-type-modal__hint">
      Обычная игра сейчас недоступна
    </p>
    <p v-else-if="!tournamentAvailable" class="match-type-modal__hint">
      Турнирная игра доступна только участникам турнира
    </p>

    <AppButton variant="ghost" @click="close">
      Отмена
    </AppButton>
  </AppModal>
</template>

<style lang="scss" scoped>
:deep(.match-type-modal) {
  gap: 12px;
}

.match-type-modal {
  &__title {
    margin-bottom: 4px;
    color: var(--color-text);
    font-size: 21px;
    font-weight: 900;
    text-align: center;
  }

  &__hint {
    color: var(--color-hint);
    font-size: 13px;
    font-weight: 650;
    text-align: center;
  }
}
</style>
