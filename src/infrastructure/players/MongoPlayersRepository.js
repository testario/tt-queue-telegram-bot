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
  }

  async connect() {
    this.client = new MongoClient(this.uri)
    await this.client.connect()
    const db = this.client.db(this.dbName)
    this.collection = db.collection(this.collectionName)
    await this.collection.createIndex({ username: 1 }, { unique: true })
    this.log.info('Подключение к MongoDB для players установлено', {
      db: this.dbName,
      collection: this.collectionName,
    })
  }

  /**
   * Создаёт или обновляет запись об игроке.
   * @param {{ username: string, userId: number, firstName?: string, lastName?: string }} player
   */
  async upsert({ username, userId, firstName, lastName }) {
    if (!username) return
    const now = new Date()
    await this.collection.updateOne(
      { username },
      {
        $set: {
          userId,
          firstName: firstName ?? '',
          lastName: lastName ?? '',
          displayName:
            [firstName, lastName].filter(Boolean).join(' ') || username.replace('@', ''),
          lastSeenAt: now,
        },
        $setOnInsert: { firstSeenAt: now },
      },
      { upsert: true }
    )
  }

  /**
   * Возвращает всех игроков, отсортированных по lastSeenAt (новые первые).
   * @returns {Promise<Array>}
   */
  async findAll() {
    return this.collection
      .find(
        {},
        {
          projection: {
            _id: 0,
            username: 1,
            displayName: 1,
            firstName: 1,
            lastName: 1,
            userId: 1,
            lastSeenAt: 1,
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
  async findOne(username) {
    return this.collection.findOne({ username }, { projection: { _id: 0 } })
  }

  /**
   * Удаляет игрока по username (с @).
   * @param {string} username
   * @returns {Promise<boolean>}
   */
  async deleteOne(username) {
    const result = await this.collection.deleteOne({ username })
    return result.deletedCount > 0
  }
}
