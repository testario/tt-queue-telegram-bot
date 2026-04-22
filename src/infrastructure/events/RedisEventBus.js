import { createNullLogger } from '#infrastructure/logger/Logger.js'

const QUEUE_EVENTS_CHANNEL = 'queue:events'

/**
 * Кросс-процессный event bus на основе Redis Pub/Sub.
 *
 * Публикация: bot-процесс после каждого изменения состояния.
 * Подписка: backend-процесс для рассылки SSE-клиентам.
 */
class RedisEventBus {
  /**
   * @param {{ publisher: import('ioredis').Redis, subscriber: import('ioredis').Redis, logger?: object }} deps
   * Важно: publisher и subscriber — РАЗНЫЕ клиенты. Redis не позволяет
   * использовать один клиент и для PUBLISH, и для SUBSCRIBE одновременно.
   */
  constructor({ publisher, subscriber, logger }) {
    this.publisher = publisher
    this.subscriber = subscriber
    this.log = logger || createNullLogger()
    this._handlers = new Set()
  }

  /**
   * Публикует событие в Redis-канал (вызывается из bot-процесса).
   * @param {{ type: string, chatId: string|number, payload?: object }} event
   */
  async publish(event) {
    const message = JSON.stringify(event)
    await this.publisher.publish(QUEUE_EVENTS_CHANNEL, message)
    this.log.info('RedisEventBus: опубликовано событие', { type: event.type })
  }

  /**
   * Подписывается на события из Redis-канала (вызывается из backend-процесса).
   * @param {(event: object) => void} handler
   */
  async subscribe(handler) {
    this._handlers.add(handler)
    // Подписываемся один раз — все обработчики вызываем в цикле
    if (this._handlers.size === 1) {
      await this.subscriber.subscribe(QUEUE_EVENTS_CHANNEL)
      this.subscriber.on('message', (channel, message) => {
        if (channel !== QUEUE_EVENTS_CHANNEL) return
        try {
          const event = JSON.parse(message)
          this._handlers.forEach(h => h(event))
        } catch (err) {
          this.log.error('RedisEventBus: ошибка разбора события', { message: err.message })
        }
      })
    }
  }

  /**
   * Отписывается от Redis-канала.
   */
  async unsubscribe() {
    await this.subscriber.unsubscribe(QUEUE_EVENTS_CHANNEL)
    this._handlers.clear()
    this.log.info('RedisEventBus: отписан от канала')
  }
}

export { RedisEventBus }
