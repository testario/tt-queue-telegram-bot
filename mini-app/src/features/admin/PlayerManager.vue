<script setup>
import { ref, onMounted } from 'vue'
import { useApi } from '@/composables/useApi.js'
import { usePlayers } from '@/composables/usePlayers.js'
import { useAdminPlayers } from '@/composables/useAdminPlayers.js'
import PlayerAvatar from '@/shared/ui/PlayerAvatar.vue'

const api = useApi()
// Основной список — общий usePlayers (тот же, что и на вкладке "Игроки"):
// бан/восстановление отсюда сразу видны везде, без отдельного admin-стейта.
const { state, players, load, setBanned } = usePlayers()
// useAdminPlayers — только для секции "Не подтверждены" ниже: ей нужен
// chat_id (userId), которого в публичном /api/players нет.
const { pending, load: loadPending, banByUserId } = useAdminPlayers()

const deletingUsername = ref(null)  // username игрока, которого удаляем прямо сейчас
const banningUserId = ref(null)     // userId неподтверждённого игрока, которого баним прямо сейчас

onMounted(() => {
  load().catch((err) => console.error('Не удалось загрузить список игроков', err))
  loadPending()
})

const showConfirmPopup = (message, onConfirm) => {
  const tg = window.Telegram?.WebApp
  if (tg?.showPopup) {
    tg.showPopup(
      { message, buttons: [{ id: 'ok', text: 'Заблокировать' }, { type: 'cancel' }] },
      (buttonId) => { if (buttonId === 'ok') onConfirm() }
    )
  } else {
    if (window.confirm(message)) onConfirm()
  }
}

const confirmBan = (username) => {
  showConfirmPopup(
    `Заблокировать ${username}? Игрок останется в списке, но не сможет пользоваться функциями.`,
    () => banPlayer(username)
  )
}

// Бан прямо из списка неподтверждённых — по chat_id, не дожидаясь резолва
// username: именно это не даёт спамеру продолжать пользоваться ботом или
// засыпать чат заявками, пока админ разбирается с текущей.
const confirmBanById = (pendingPlayer) => {
  showConfirmPopup(
    `Заблокировать ${pendingPlayer.displayName || pendingPlayer.username}? Он больше не сможет пользоваться ботом.`,
    () => banPendingPlayer(pendingPlayer)
  )
}

const restorePlayer = async (username) => {
  deletingUsername.value = username
  try {
    await api.patch(`/players/${username.replace('@', '')}`, { banned: false })
    setBanned(username, false)
  } catch (err) {
    // Список остаётся как есть — молча, но логируем: иначе, например,
    // забаненный чат-админ (403 cannot_ban_admin) выглядит как случайный
    // промах мимо кнопки, без единой зацепки в консоли, что пошло не так.
    console.error('Не удалось восстановить игрока', username, err)
  } finally {
    deletingUsername.value = null
  }
}

const banPlayer = async (username) => {
  deletingUsername.value = username
  try {
    await api.del(`/players/${username.replace('@', '')}`)
    setBanned(username, true)
  } catch (err) {
    console.error('Не удалось забанить игрока', username, err)
  } finally {
    deletingUsername.value = null
  }
}

const banPendingPlayer = async (pendingPlayer) => {
  banningUserId.value = pendingPlayer.userId
  try {
    await banByUserId(pendingPlayer.userId)
  } catch (err) {
    console.error('Не удалось забанить игрока по chat_id', pendingPlayer.userId, err)
  } finally {
    banningUserId.value = null
  }
}
</script>

<template>
  <section class="player-manager">
    <!-- Игроки, которые уже открыли мини-апп, но ещё не подтверждены
         (независимо от того, нажимали ли они кнопку запроса подтверждения
         в чате) — их можно сразу забанить по chat_id, не дожидаясь этого.
         Список синхронизируется в реальном времени (см. players_update в
         useQueue.js/useAdminPlayers.js). -->
    <template v-if="pending.length">
      <h3 class="player-manager__title">Не подтверждены</h3>
      <div class="player-manager__list">
        <div
          v-for="p in pending"
          :key="p.userId"
          class="player-manager__row"
        >
          <PlayerAvatar :username="p.username" :size="36" />
          <div class="player-manager__info">
            <span class="player-manager__name">{{ p.displayName }}</span>
            <span class="player-manager__username">{{ p.username }} · chat_id: {{ p.userId }}</span>
          </div>
          <button
            class="player-manager__action"
            :disabled="banningUserId === p.userId"
            :aria-label="`Заблокировать ${p.username}`"
            @click="confirmBanById(p)"
          >
            Бан
          </button>
        </div>
      </div>
    </template>

    <h3 class="player-manager__title">Список игроков</h3>

    <p v-if="state.loading && !state.loaded" class="player-manager__hint">Загрузка...</p>

    <p v-else-if="!players.length" class="player-manager__hint">
      Список пуст
    </p>

    <div v-else class="player-manager__list">
      <div
        v-for="p in players"
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
        <span v-else-if="!p.verified" class="player-manager__pending">Не подтверждён</span>
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

  &__pending {
    flex: 0 0 auto;
    padding: 5px 8px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--color-warning), transparent 84%);
    color: var(--color-warning);
    font-size: 11px;
    font-weight: 900;
  }
}
</style>
