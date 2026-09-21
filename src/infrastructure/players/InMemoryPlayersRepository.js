/**
 * In-memory хранилище игроков.
 * Используется как fallback, когда PLAYERS_MONGODB_URI не задан.
 */
export class InMemoryPlayersRepository {
  constructor() {
    this.players = new Map()
    // Только текущие usernames участвуют в обычном lookup. История хранится
    // внутри записи и используется исключительно для targeted cleanup.
    this.playersByUsername = new Map()
    this.playersByUserId = new Map()
    this.identityVersions = new Map()
  }

  async upsert({ username, userId, firstName, lastName, generation }) {
    if (!username) return
    const hasUserId = userId !== undefined && userId !== null
    const existingByUserId = hasUserId ? this.playersByUserId.get(String(userId)) : null
    const existingByUsername = this.playersByUsername.get(username)
    const requestedGeneration = generation !== undefined && generation !== null
      && Number.isSafeInteger(Number(generation)) && Number(generation) >= 1
      ? Number(generation)
      : null
    const highestGeneration = Math.max(
      this.identityVersions.get(username) || 0,
      existingByUsername?.generation || 0,
      existingByUsername?.identityVersion || 0,
      existingByUserId?.generation || 0,
      existingByUserId?.identityVersion || 0,
    )
    if (requestedGeneration !== null && requestedGeneration < highestGeneration) return false
    if (requestedGeneration !== null && [existingByUsername, existingByUserId].some((existing) =>
      existing && Number(existing.generation ?? existing.identityVersion) === requestedGeneration
      && (existing.username !== username || String(existing.userId) !== String(userId)))) return false
    const usernameOwnerChanged = existingByUsername && hasUserId
      && (existingByUsername.userId == null || String(existingByUsername.userId) !== String(userId))
    let existing = existingByUserId || existingByUsername

    let identityVersion = requestedGeneration ?? this.identityVersions.get(username)
      ?? existingByUsername?.identityVersion
      ?? 0
    if (requestedGeneration === null
      && (usernameOwnerChanged || (!existingByUsername && this.identityVersions.has(username)))) identityVersion += 1
    if (identityVersion === 0) identityVersion = 1
    this.identityVersions.set(username, identityVersion)

    if (existingByUserId && existingByUsername && existingByUserId !== existingByUsername) {
      // Username может быть переиспользован другим Telegram userId. Старый
      // record остаётся доступен по userId, но теряет current username owner.
      this.players.delete(existingByUsername.username)
      this.playersByUsername.delete(username)
    }

    if (existingByUsername && hasUserId
      && (existingByUsername.userId == null
        || String(existingByUsername.userId) !== String(userId))) {
      this.players.delete(existingByUsername.username)
      this.playersByUsername.delete(username)
      if (!existingByUserId) existing = null
    }

    if (existingByUserId && existingByUserId.username !== username) {
      this.players.delete(existingByUserId.username)
      this.playersByUsername.delete(existingByUserId.username)
    }

    const usernames = [...new Set([
      ...(existing?.usernames || []),
      existing?.username,
    ].filter(Boolean).filter((name) => name !== username))]

    const player = {
      username,
      usernames,
      userId: hasUserId ? userId : existing?.userId,
      firstName: firstName ?? '',
      lastName: lastName ?? '',
      displayName:
        [firstName, lastName].filter(Boolean).join(' ') || username.replace('@', ''),
      lastSeenAt: new Date(),
      firstSeenAt: existing?.firstSeenAt ?? new Date(),
      generation: identityVersion,
      identityVersion,
      // Повторная регистрация не должна снимать ранее установленный бан.
      banned: existing?.banned === true,
      // Повторная регистрация не должна снимать ранее пройденное подтверждение.
      verified: existing?.verified === true,
    }
    this.players.set(username, player)
    this.playersByUsername.set(username, player)
    if (player.userId !== undefined && player.userId !== null) {
      this.playersByUserId.set(String(player.userId), player)
    }
    return true
  }

  async claimIdentity(player) {
    const result = await this.upsert(player)
    if (result === false) return { ok: false }
    const persisted = await this.findOne(player.username)
    const generation = persisted?.generation ?? persisted?.identityVersion
    return {
      ok: Boolean(persisted
        && String(persisted.userId) === String(player.userId)
        && Number(generation) === Number(player.generation)),
    }
  }

  async findAll() {
    return Array.from(this.players.values())
      .filter((player) => !/^@__former_/.test(player.username))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
  }

  async migrateIdentityGenerations() {
    const current = [...this.playersByUsername.values()]
      .filter((player) => !/^@__former_/.test(player.username || ''))
      .sort((left, right) => String(left.userId ?? '').localeCompare(String(right.userId ?? ''))
        || left.username.localeCompare(right.username))
    let nextGeneration = Math.max(0, ...current.map((player) =>
      Math.max(Number(player.generation) || 0, Number(player.identityVersion) || 0)
    )) + 1
    for (const player of current) {
      const generation = Number(player.generation ?? player.identityVersion)
      if (Number.isSafeInteger(generation) && generation >= 1) continue
      player.generation = nextGeneration
      player.identityVersion = nextGeneration
      this.identityVersions.set(player.username, nextGeneration)
      nextGeneration += 1
    }
    return current.length
  }

  async findOne(username) {
    return this.playersByUsername.get(username) ?? null
  }

  async findByUserId(userId) {
    if (userId === undefined || userId === null) return null
    return this.playersByUserId.get(String(userId)) ?? null
  }

  async isBanned(userId) {
    if (typeof userId === 'string' && userId.startsWith('@')) {
      return (await this.findOne(userId))?.banned === true
    }
    const player = await this.findByUserId(userId)
    return player?.banned === true
  }

  async getAliases(username) {
    const player = await this.findOne(username)
    if (!player) return []
    return [...new Set([player.username, ...(player.usernames || [])])]
  }

  async getAliasesByUserId(userId) {
    const player = await this.findByUserId(userId)
    if (!player) return []
    return [...new Set([player.username, ...(player.usernames || [])])]
  }

  async deleteOne(username) {
    // Старый API удаления теперь означает персистентный бан.
    return this.banOne(username)
  }

  async setBanned(username, banned) {
    const player = this.playersByUsername.get(username)
    if (!player) return false
    player.banned = banned === true
    return true
  }

  async banOne(username) {
    return this.setBanned(username, true)
  }

  async unbanOne(username) {
    return this.setBanned(username, false)
  }

  async isVerified(userId) {
    if (typeof userId === 'string' && userId.startsWith('@')) {
      return (await this.findOne(userId))?.verified === true
    }
    const player = await this.findByUserId(userId)
    return player?.verified === true
  }

  async setVerified(username, verified) {
    const player = this.playersByUsername.get(username)
    if (!player) return false
    player.verified = verified === true
    return true
  }
}
