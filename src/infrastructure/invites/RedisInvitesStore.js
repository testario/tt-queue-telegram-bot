const INVITES_KEY = 'queue:invites'

/**
 * Redis-хранилище ожидающих прямых приглашений.
 * Использует Redis Hash: поле = @player, значение = JSON { player, opponent, createdAt }.
 */
export class RedisInvitesStore {
  constructor({ client, key = INVITES_KEY }) {
    this.client = client
    this.key = key
  }

  async set(player, invite) {
    await this.client.hset(this.key, player, JSON.stringify(invite))
  }

  async delete(player) {
    await this.client.hdel(this.key, player)
  }

  async getAll() {
    const raw = await this.client.hgetall(this.key)
    if (!raw) return []
    return Object.values(raw).map(v => JSON.parse(v))
  }
}
