import { QueueState } from '#domain/entities/QueueState.js'
import { createNullLogger } from '#infrastructure/logger/Logger.js'

const DEFAULT_KEY = 'queue:state'

/**
 * Хранит состояние очереди в Redis (JSON-сериализация).
 * @implements {import("#application/types.js").QueueRepository}
 */
class RedisQueueRepository {
  /**
   * @param {{ client: import('ioredis').Redis, key?: string, logger?: object }} deps
   */
  constructor({ client, key = DEFAULT_KEY, logger }) {
    this.client = client
    this.key = key
    this.log = logger || createNullLogger()
  }

  /**
   * Читает текущее состояние из Redis.
   * Если ключ не существует — возвращает пустое состояние.
   * @returns {Promise<QueueState>}
   */
  async get() {
    const raw = await this.client.get(this.key)
    if (!raw) return QueueState.createEmpty()
    try {
      return QueueState.from(JSON.parse(raw))
    } catch (err) {
      this.log.error('Ошибка десериализации состояния из Redis, возврат к пустому', {
        message: err.message,
      })
      return QueueState.createEmpty()
    }
  }

  /**
   * Сохраняет состояние очереди в Redis.
   * @param {QueueState} state
   * @returns {Promise<void>}
   */
  async save(state) {
    await this.client.set(this.key, JSON.stringify(state))
  }
}

export { RedisQueueRepository }
