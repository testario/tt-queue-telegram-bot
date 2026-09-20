<script setup>
import { ref, onMounted } from 'vue'
import { useApi } from '@/composables/useApi.js'
import { usePlayers } from '@/composables/usePlayers.js'
import PlayerAvatar from '@/shared/ui/PlayerAvatar.vue'

const api = useApi()
const { state, load, setBanned } = usePlayers()

const deletingUsername = ref(null)  // username игрока, которого удаляем прямо сейчас

onMounted(() => load())

const confirmBan = (username) => {
  const tg = window.Telegram?.WebApp
  const message = `Заблокировать ${username}? Игрок останется в списке, но не сможет пользоваться функциями.`

  if (tg?.showPopup) {
    tg.showPopup(
      { message, buttons: [{ id: 'ok', text: 'Заблокировать' }, { type: 'cancel' }] },
      (buttonId) => { if (buttonId === 'ok') banPlayer(username) }
    )
  } else {
    if (window.confirm(message)) banPlayer(username)
  }
}

const restorePlayer = async (username) => {
  deletingUsername.value = username
  try {
    await api.patch(`/players/${username.replace('@', '')}`, { banned: false })
    setBanned(username, false)
  } catch {
    // Ошибка — ничего не делаем, список остаётся как есть
  } finally {
    deletingUsername.value = null
  }
}

const banPlayer = async (username) => {
  deletingUsername.value = username
  try {
    await api.del(`/players/${username.replace('@', '')}`)
    setBanned(username, true)
  } catch {
    // Ошибка — список остаётся без изменений
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
        <span v-if="p.isAdmin" class="player-manager__admin">Админ</span>
        <span v-if="p.banned" class="player-manager__ban">Бан</span>
        <button
          v-if="!p.isAdmin || p.banned"
          :class="['player-manager__action', { 'player-manager__action--restore': p.banned }]"
          :disabled="deletingUsername === p.username"
          :aria-label="p.banned ? `Вернуть ${p.username}` : `Заблокировать ${p.username}`"
          @click="p.banned ? restorePlayer(p.username) : confirmBan(p.username)"
        >
          {{ p.banned ? 'Вернуть' : 'Бан' }}
        </button>
      </div>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.player-manager {
  padding-top: 4px;

  &__title {
    font-size: 15px;
    font-weight: 800;
    color: var(--color-hint);
    margin-bottom: 10px;
  }

  &__hint {
    font-size: 14px;
    font-weight: 600;
    color: var(--color-hint);
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  &__row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 60px;
    padding: 10px;
    border: 1px solid var(--color-border);
    border-radius: 18px;
    background: var(--color-bg);

    &:hover { background: var(--color-surface-soft); }
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
    font-weight: 850;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__username {
    font-size: 12px;
    font-weight: 650;
    color: var(--color-hint);
  }

  &__action {
    flex: 0 0 auto;
    min-height: 34px;
    padding: 0 8px;
    border: none;
    background: transparent;
    color: var(--color-danger);
    font-size: 13px;
    font-weight: 850;
    cursor: pointer;

    &:hover {
      background: color-mix(in srgb, var(--color-danger), transparent 90%);
      border-radius: 10px;
    }

    &:disabled { opacity: 0.4; cursor: not-allowed; }

    &--restore { color: var(--color-button); }
  }

  &__ban {
    flex: 0 0 auto;
    padding: 5px 8px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--color-danger), transparent 84%);
    color: var(--color-danger);
    font-size: 11px;
    font-weight: 900;
  }

  &__admin {
    flex: 0 0 auto;
    padding: 5px 8px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--color-success), transparent 84%);
    color: var(--color-success);
    font-size: 11px;
    font-weight: 900;
  }
}
</style>
