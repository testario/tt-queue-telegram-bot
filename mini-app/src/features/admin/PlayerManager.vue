<script setup>
import { ref, onMounted } from 'vue'
import { useApi } from '@/composables/useApi.js'
import { usePlayers } from '@/composables/usePlayers.js'
import PlayerAvatar from '@/shared/ui/PlayerAvatar.vue'
import AppButton from '@/shared/ui/AppButton.vue'

const api = useApi()
const { state, load, remove } = usePlayers()

const deletingUsername = ref(null)  // username игрока, которого удаляем прямо сейчас

onMounted(() => load())

const confirmDelete = (username) => {
  const tg = window.Telegram?.WebApp
  const message = `Удалить ${username} из списка игроков?`

  if (tg?.showPopup) {
    tg.showPopup(
      { message, buttons: [{ id: 'ok', text: 'Удалить' }, { type: 'cancel' }] },
      (buttonId) => { if (buttonId === 'ok') deletePlayer(username) }
    )
  } else {
    if (window.confirm(message)) deletePlayer(username)
  }
}

const deletePlayer = async (username) => {
  deletingUsername.value = username
  try {
    await api.del(`/players/${username.replace('@', '')}`)
    // Обновить кеш: удалить локально без повторного запроса
    remove(username)
  } catch {
    // Ошибка — ничего не делаем, список остаётся как есть
  } finally {
    deletingUsername.value = null
  }
}
</script>

<template>
  <section class="player-manager">
    <h3 class="player-manager__title">Список игроков</h3>

    <p v-if="state.loading" class="player-manager__hint">Загрузка...</p>

    <p v-else-if="!state.players.length" class="player-manager__hint">
      Список пуст
    </p>

    <div v-else class="player-manager__list">
      <div
        v-for="p in state.players"
        :key="p.username"
        class="player-manager__row"
      >
        <PlayerAvatar :username="p.username" :size="36" />
        <div class="player-manager__info">
          <span class="player-manager__name">{{ p.displayName }}</span>
          <span class="player-manager__username">{{ p.username }}</span>
        </div>
        <button
          class="player-manager__delete"
          :disabled="deletingUsername === p.username"
          @click="confirmDelete(p.username)"
        >
          ✕
        </button>
      </div>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.player-manager {
  &__title {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-hint);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 10px;
  }

  &__hint {
    font-size: 14px;
    color: var(--color-hint);
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  &__row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 4px;
    border-radius: 8px;

    &:hover { background: var(--color-secondary-bg); }
  }

  &__info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
    overflow: hidden;
  }

  &__name {
    font-size: 14px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__username {
    font-size: 12px;
    color: var(--color-hint);
  }

  &__delete {
    border: none;
    background: none;
    color: var(--color-hint);
    font-size: 16px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
    flex-shrink: 0;

    &:hover { color: #ff3b30; background: rgba(255, 59, 48, 0.1); }
    &:disabled { opacity: 0.4; cursor: not-allowed; }
  }
}
</style>
