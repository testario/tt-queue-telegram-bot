import { QueueState } from '#domain/entities/QueueState.js'
import { createNullLogger } from '#infrastructure/logger/Logger.js'

const DEFAULT_KEY = 'queue:state'
const REVISION_SUFFIX = ':revision'

const SAVE_SCRIPT = `
  local revision = tonumber(redis.call('GET', KEYS[2]) or '0') + 1
  redis.call('SET', KEYS[1], ARGV[1])
  redis.call('SET', KEYS[2], revision)
  return revision
`

const SAVE_IF_REVISION_SCRIPT = `
  local current = tonumber(redis.call('GET', KEYS[2]) or '0')
  local expected = tonumber(ARGV[1])
  if not expected or current ~= expected then return 0 end
  redis.call('SET', KEYS[1], ARGV[2])
  redis.call('SET', KEYS[2], current + 1)
  return 1
`

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
    this.revisionKey = `${key}${REVISION_SUFFIX}`
    this.log = logger || createNullLogger()
  }

  /**
   * Читает текущее состояние из Redis.
   * Если ключ не существует — возвращает пустое состояние.
   * @returns {Promise<QueueState>}
   */
  async get() {
    const { state } = await this.getVersioned()
    return state
  }

  async getVersioned() {
    const [rawValue, revisionValue] = await this.getRawVersioned()
    const revision = Number(revisionValue) || 0
    if (!rawValue) return { state: QueueState.createEmpty(), revision }
    try {
      return { state: QueueState.from(JSON.parse(rawValue)), revision }
    } catch (err) {
      this.log.error('Ошибка десериализации состояния из Redis, возврат к пустому', {
        message: err.message,
      })
      return { state: QueueState.createEmpty(), revision }
    }
  }

  async getRawVersioned() {
    if (typeof this.client.multi !== 'function') {
      return Promise.all([this.client.get(this.key), this.client.get(this.revisionKey)])
    }
    const result = await this.client.multi().get(this.key).get(this.revisionKey).exec()
    const unwrap = (item) => (Array.isArray(item) && item.length === 2 ? item[1] : item)
    return [unwrap(result[0]), unwrap(result[1])]
  }

  /**
   * Сохраняет состояние очереди в Redis.
   * @param {QueueState} state
   * @returns {Promise<void>}
   */
  async save(state) {
    await this.client.eval(SAVE_SCRIPT, 2, this.key, this.revisionKey, JSON.stringify(state))
  }

  async saveIfRevision(expectedRevision, state) {
    const result = await this.client.eval(
      SAVE_IF_REVISION_SCRIPT,
      2,
      this.key,
      this.revisionKey,
      expectedRevision,
      JSON.stringify(state)
    )
    return Number(result) === 1
  }
}

export { RedisQueueRepository }
