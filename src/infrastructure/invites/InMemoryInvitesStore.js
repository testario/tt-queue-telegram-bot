/**
 * In-memory хранилище ожидающих прямых приглашений.
 * Используется когда Redis недоступен.
 */
export class InMemoryInvitesStore {
  constructor() {
    this._map = new Map()
  }

  async set(player, invite) {
    this._map.set(player, invite)
  }

  async delete(player) {
    this._map.delete(player)
  }

  async getAll() {
    return Array.from(this._map.values())
  }
}
