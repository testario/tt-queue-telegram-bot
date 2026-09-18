import { MongoClient } from 'mongodb'
import { createNullLogger } from '../logger/Logger.js'

/**
 * Персистентное хранилище игроков на MongoDB.
 */
export class MongoPlayersRepository {
  /**
   * @param {{ uri: string, dbName: string, collectionName?: string, logger?: object }} deps
   */
  constructor({ uri, dbName, collectionName = 'players', logger }) {
    this.uri = uri
    this.dbName = dbName
    this.collectionName = collectionName
    this.log = logger || createNullLogger()
    this.client = null
    this.collection = null
    this.closePromise = null
  }

  async connect() {
    this.closePromise = null
    this.client = new MongoClient(this.uri)
    await this.client.connect()
    const db = this.client.db(this.dbName)
    this.collection = db.collection(this.collectionName)
    await this.collection.createIndex({ username: 1 }, { unique: true })
    // Normalize before enforcing uniqueness. The migration merges every
    // duplicate into its primary first, so a failed delete cannot lose data.
    await this.migrateIdentityGenerations()
    await this.ensureUniqueUserIdIndex()
    await this.collection.createIndex({ usernames: 1 })
    this.log.info('Подключение к MongoDB для players установлено', {
      db: this.dbName,
      collection: this.collectionName,
    })
  }

  async ensureUniqueUserIdIndex() {
    const options = { unique: true, sparse: true }
    try {
      await this.collection.createIndex({ userId: 1 }, options)
      return
    } catch (firstError) {
      this.log.warn('Не удалось создать уникальный индекс players.userId, повтор после миграции', {
        message: firstError.message,
      })
    }

    await this.migrateIdentityGenerations()
    await this.dropNonUniqueUserIdIndexes()
    try {
      await this.collection.createIndex({ userId: 1 }, options)
    } catch (error) {
      throw new Error(
        `Не удалось установить уникальность players.userId после миграции: ${error.message}`
      )
    }
  }

  async dropNonUniqueUserIdIndexes() {
    if (typeof this.collection.listIndexes === 'function') {
      const indexes = await this.collection.listIndexes().toArray()
      for (const index of indexes) {
        if (index.name === '_id_' || index.unique || index.key?.userId !== 1
          || Object.keys(index.key).length !== 1) continue
        await this.collection.dropIndex(index.name)
      }
      return
    }

    // Older deployments created this named lookup index before uniqueness was
    // made mandatory. Missing indexes are harmless during the retry.
    if (typeof this.collection.dropIndex === 'function') {
      for (const name of ['players_userId_lookup', 'userId_1']) {
        try {
          await this.collection.dropIndex(name)
        } catch {
          // The index may not exist.
        }
      }
    }
  }

  /**
   * Создаёт или обновляет запись об игроке.
   * @param {{ username: string, userId: number, generation?: number, firstName?: string, lastName?: string }} player
   */
  async upsert({ username, userId, generation, firstName, lastName }) {
    if (!username) return
    const now = new Date()
    const hasUserId = userId !== undefined && userId !== null
    const existingByUserId = hasUserId
      ? await this.collection.findOne({ userId })
      : null

    let existingByUsername = await this.collection.findOne({ username })
    const historicalUsernameOwner = !existingByUsername && hasUserId
      ? await this.collection.findOne({ usernames: username })
      : null
    const previousUsernameOwner = existingByUsername || historicalUsernameOwner
    const requestedGeneration = generation !== undefined && generation !== null
      && Number.isSafeInteger(Number(generation)) && Number(generation) >= 1
      ? Number(generation)
      : null
    const currentUsernameOwner = existingByUsername && hasUserId
      && String(existingByUsername.userId) === String(userId)
      ? existingByUsername
      : null
    const highestGeneration = Math.max(
      Number(existingByUsername?.generation) || 0,
      Number(existingByUsername?.identityVersion) || 0,
      Number(currentUsernameOwner?.generation) || 0,
      Number(currentUsernameOwner?.identityVersion) || 0,
      Number(existingByUserId?.generation) || 0,
      Number(existingByUserId?.identityVersion) || 0,
    )
    if (requestedGeneration !== null && requestedGeneration < highestGeneration) return false
    if (requestedGeneration !== null && [currentUsernameOwner, existingByUserId].some((existing) =>
      existing && Number(existing.generation ?? existing.identityVersion) === requestedGeneration
      && (existing.username !== username || String(existing.userId) !== String(userId)))) return false
    const usernameOwnerChanged = (existingByUsername && hasUserId
      && (existingByUsername.userId == null || String(existingByUsername.userId) !== String(userId)))
      || Boolean(historicalUsernameOwner)
    if (existingByUsername && existingByUserId && existingByUsername._id?.toString() === existingByUserId._id?.toString()) {
      existingByUsername = existingByUserId
    }

    if (existingByUsername && existingByUsername !== existingByUserId && hasUserId) {
      // A username is reusable. Detach the former current owner while keeping
      // the old spelling in its alias history for targeted state cleanup.
      const formerUsername = `@__former_${String(existingByUsername.userId || existingByUsername._id).replace(/[^a-zA-Z0-9_]/g, '_')}`
      await this.collection.updateOne(
        {
          _id: existingByUsername._id,
          username: existingByUsername.username,
          ...(existingByUsername.generation != null
            ? { generation: existingByUsername.generation }
            : existingByUsername.identityVersion != null
              ? { identityVersion: existingByUsername.identityVersion }
              : {}),
        },
        { $set: { username: formerUsername }, $addToSet: { usernames: username } }
      )
      existingByUsername = null
    }

    const existing = existingByUserId || existingByUsername
    const previousGeneration = Number(
      (currentUsernameOwner || previousUsernameOwner)?.generation
        ?? (currentUsernameOwner || previousUsernameOwner)?.identityVersion
    ) || 0

    const fields = {
      username,
      usernames: [...new Set([
        ...(existing?.usernames || []),
        existing?.username,
      ].filter(Boolean).filter((name) => name !== username))],
      firstName: firstName ?? '',
      lastName: lastName ?? '',
      displayName:
        [firstName, lastName].filter(Boolean).join(' ') || username.replace('@', ''),
      lastSeenAt: now,
      generation: requestedGeneration ?? (usernameOwnerChanged
        ? previousGeneration + 1
        : Number((existingByUsername || historicalUsernameOwner)?.generation
          ?? (existingByUsername || historicalUsernameOwner)?.identityVersion) || 1),
      identityVersion: requestedGeneration ?? (usernameOwnerChanged
        ? previousGeneration + 1
        : Number((existingByUsername || historicalUsernameOwner)?.generation
          ?? (existingByUsername || historicalUsernameOwner)?.identityVersion) || 1),
    }
    if (hasUserId) fields.userId = userId
    let existingFilter = { username }
    if (existing?._id) {
      existingFilter = { _id: existing._id }
    } else if (existing && hasUserId) {
      existingFilter = { userId }
    }
    if (requestedGeneration !== null) {
      existingFilter = {
        ...existingFilter,
        $or: [
          { generation: { $lt: requestedGeneration } },
          { generation: requestedGeneration, userId },
          { generation: { $exists: false }, identityVersion: { $lt: requestedGeneration } },
          { generation: { $exists: false }, identityVersion: requestedGeneration, userId },
          { generation: { $exists: false }, identityVersion: { $exists: false } },
        ],
      }
    }

    await this.collection.updateOne(
      existingFilter,
      {
        $set: fields,
        $setOnInsert: { firstSeenAt: now },
      },
      { upsert: true }
    )
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

  /**
   * Возвращает всех игроков, отсортированных по lastSeenAt (новые первые).
   * @returns {Promise<Array>}
   */
  async findAll() {
    return this.collection
      .find(
        { username: { $not: /^@__former_/ } },
        {
          projection: {
            _id: 0,
            username: 1,
            displayName: 1,
            firstName: 1,
            lastName: 1,
            userId: 1,
            lastSeenAt: 1,
            generation: 1,
             identityVersion: 1,
            banned: 1,
          },
        }
      )
      .sort({ lastSeenAt: -1 })
      .toArray()
  }

  /**
   * Находит игрока по username (с @).
   * @param {string} username
   * @returns {Promise<object|null>}
   */
  async migrateIdentityGenerations() {
    const documents = await this.collection.find({}).toArray()
    const compareDocuments = (left, right) => {
      const leftSynthetic = /^@__former_/.test(left.username || '')
      const rightSynthetic = /^@__former_/.test(right.username || '')
      if (leftSynthetic !== rightSynthetic) return leftSynthetic ? 1 : -1

      const leftGeneration = Math.max(Number(left.generation) || 0, Number(left.identityVersion) || 0)
      const rightGeneration = Math.max(Number(right.generation) || 0, Number(right.identityVersion) || 0)
      if (leftGeneration !== rightGeneration) return rightGeneration - leftGeneration
      const leftSeen = left.lastSeenAt ? new Date(left.lastSeenAt).getTime() : 0
      const rightSeen = right.lastSeenAt ? new Date(right.lastSeenAt).getTime() : 0
      if (leftSeen !== rightSeen) return rightSeen - leftSeen
      return `${left.username || ''}:${String(left._id || '')}`
        .localeCompare(`${right.username || ''}:${String(right._id || '')}`)
    }

    // Legacy migrations could leave one document for every username used by a
    // Telegram user. Keep the newest real username and merge every duplicate
    // into it before deleting anything.
    const isInvalidLegacyUserId = (userId) => userId == null
      || (typeof userId === 'string' && userId.trim() === '')
      || (typeof userId === 'number' && !Number.isFinite(userId))
    const groups = new Map()
    for (const document of documents) {
      const key = isInvalidLegacyUserId(document.userId)
        ? `document:${String(document._id || document.username || '')}`
        : `user:${String(document.userId)}`
      const group = groups.get(key) || []
      group.push(document)
      groups.set(key, group)
    }

    const canonical = []
    for (const group of groups.values()) {
      const ordered = [...group].sort(compareDocuments)
      const current = ordered.find((document) => !/^@__former_/.test(document.username || ''))
      const primary = current || ordered[0]
      if (!primary) continue

      const aliases = [...new Set(ordered.flatMap((document) => [
        document.username,
        ...(Array.isArray(document.usernames) ? document.usernames : []),
      ]).filter((username) => username
        && username !== primary.username
        && !/^@__former_/.test(username)))]
      const generation = Math.max(0, ...ordered.map((document) => Math.max(
        Number(document.generation) || 0,
        Number(document.identityVersion) || 0,
      )))
      primary.__migrationAliases = aliases
      primary.__migrationGeneration = generation
      primary.__migrationBanned = ordered.some((document) => document.banned === true)
      canonical.push(primary)
    }

    let nextGeneration = Math.max(0, ...documents.map((document) =>
      Math.max(Number(document.generation) || 0, Number(document.identityVersion) || 0)
    )) + 1
    for (const document of canonical.sort((left, right) =>
      `${left.userId ?? ''}:${left.username ?? ''}:${String(left._id || '')}`
        .localeCompare(`${right.userId ?? ''}:${right.username ?? ''}:${String(right._id || '')}`)
    )) {
      const generation = Number.isSafeInteger(document.__migrationGeneration)
        && document.__migrationGeneration >= 1
        ? document.__migrationGeneration
        : nextGeneration++
      if (!document._id) {
        throw new Error('Legacy player document has no _id; refusing unsafe identity migration')
      }
      const update = {
        $set: {
          generation,
          identityVersion: generation,
          usernames: document.__migrationAliases || [],
          ...(document.__migrationBanned ? { banned: true } : {}),
        },
      }
      // Sparse unique indexes still index an explicit null (and other empty
      // legacy values). Remove those values instead of letting them collide.
      if (isInvalidLegacyUserId(document.userId)) update.$unset = { userId: '' }

      const mergeResult = await this.collection.updateOne(
        { _id: document._id },
        update
      )
      if (mergeResult?.matchedCount !== 1) {
        throw new Error(`Не удалось сохранить primary player ${String(document._id)} перед удалением дубликатов`)
      }

      const duplicates = groups.get(isInvalidLegacyUserId(document.userId)
        ? `document:${String(document._id || document.username || '')}`
        : `user:${String(document.userId)}`) || []
      for (const duplicate of duplicates) {
        if (duplicate === document || !duplicate._id) continue
        await this.collection.deleteOne({ _id: duplicate._id })
      }

      delete document.__migrationAliases
      delete document.__migrationGeneration
      delete document.__migrationBanned
    }
    return canonical.length
  }

  async findOne(username) {
    if (/^@__former_/.test(username || '')) return null
    return this.collection.findOne({ username }, { projection: { _id: 0 } })
  }

  async findByUserId(userId) {
    if (userId === undefined || userId === null) return null
    return this.collection.findOne({ userId }, { projection: { _id: 0 } })
  }

  async isBanned(userId) {
    if (typeof userId === 'string' && userId.startsWith('@')) {
      const player = await this.findOne(userId)
      return player?.banned === true
    }
    if (userId === undefined || userId === null) return false
    return Boolean(await this.collection.findOne({ userId, banned: true }, { projection: { _id: 1 } }))
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

  /**
   * Блокирует игрока по username (с @); имя метода сохранено для совместимости.
   * @param {string} username
   * @returns {Promise<boolean>}
   */
  async deleteOne(username) {
    return this.banOne(username)
  }

  /** Устанавливает статус бана, не удаляя запись игрока. */
  async setBanned(username, banned) {
    const result = await this.collection.updateOne(
      { username },
      { $set: { banned: banned === true } }
    )
    return result.matchedCount > 0
  }

  async banOne(username) {
    return this.setBanned(username, true)
  }

  async unbanOne(username) {
    return this.setBanned(username, false)
  }

  /** Безопасно закрывает MongoDB-клиент; повторный вызов ничего не делает. */
  async close() {
    if (this.closePromise) return this.closePromise
    const client = this.client
    if (!client) return

    this.client = null
    this.collection = null
    this.closePromise = Promise.resolve(client.close())
    return this.closePromise
  }
}
