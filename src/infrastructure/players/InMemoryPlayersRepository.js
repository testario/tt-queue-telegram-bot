/**
 * In-memory хранилище игроков.
 * Используется как fallback, когда PLAYERS_MONGODB_URI не задан.
 */
export class InMemoryPlayersRepository {
  constructor() {
    this.players = new Map()
  }

  async upsert({ username, userId, firstName, lastName }) {
    if (!username) return
    const existing = this.players.get(username)
    this.players.set(username, {
      username,
      userId,
      firstName: firstName ?? '',
      lastName: lastName ?? '',
      displayName:
        [firstName, lastName].filter(Boolean).join(' ') || username.replace('@', ''),
      lastSeenAt: new Date(),
      firstSeenAt: existing?.firstSeenAt ?? new Date(),
    })
  }

  async findAll() {
    return Array.from(this.players.values()).sort((a, b) => b.lastSeenAt - a.lastSeenAt)
  }

  async findOne(username) {
    return this.players.get(username) ?? null
  }

  async deleteOne(username) {
    return this.players.delete(username)
  }
}
