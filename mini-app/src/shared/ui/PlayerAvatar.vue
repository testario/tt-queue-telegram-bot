<script setup>
import { ref, computed } from 'vue'
import { usePlayers } from '@/composables/usePlayers.js'

const props = defineProps({
  username: {
    type: String,
    required: true,
  },
  size: {
    type: Number,
    default: 40,
  },
})

const { avatarUrl } = usePlayers()
const failed = ref(false)

const src = computed(() => avatarUrl(props.username))

const initials = computed(() =>
  props.username.replace('@', '').slice(0, 1).toUpperCase()
)

const onError = () => { failed.value = true }
</script>

<template>
  <div
    class="avatar"
    :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.floor(size * 0.4)}px` }"
  >
    <img
      v-if="!failed"
      :src="src"
      :alt="username"
      class="avatar__img"
      @error="onError"
    />
    <span v-else class="avatar__placeholder">{{ initials }}</span>
  </div>
</template>

<style lang="scss" scoped>
.avatar {
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  background: var(--color-secondary-bg);
  display: flex;
  align-items: center;
  justify-content: center;

  &__img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  &__placeholder {
    font-weight: 600;
    color: var(--color-hint);
    line-height: 1;
    user-select: none;
  }
}
</style>
