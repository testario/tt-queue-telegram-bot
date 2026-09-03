import EventEmitter from "events";

/**
 * Уведомитель, публикующий события через `EventEmitter`.
 * Опционально публикует в Redis Pub/Sub через `eventBus` (для кросс-процессного режима).
 */
/**
 * @implements {import("#application/types.js").Notifier}
 */
class EventNotifier {
  constructor({ emitter, eventBus } = {}) {
    this.emitter = emitter || new EventEmitter()
    this.eventBus = eventBus || null
  }

  /**
   * Отправляет сообщение подписчикам.
   * @param {number|string} chatId
   * @param {string} text
   * @param {Record<string, unknown>} [meta]
   */
  notify(chatId, text, meta = undefined) {
    this.emitter.emit("message", { chatId, text, meta });

    // Публикуем в Redis если bus настроен (bot-процесс с Redis)
    if (this.eventBus) {
      this.eventBus.publish({
        type: (meta && meta.type) || 'state_update',
        chatId: String(chatId),
        payload: meta,
      }).catch(err => {
        console.error('EventNotifier: ошибка публикации в Redis', err.message)
      })
    }
  }

  /**
   * Подписывается на входящие сообщения.
   * @param {(payload: {chatId: number|string, text: string, meta?: Record<string, unknown>}) => void} handler
   */
  onMessage(handler) {
    this.emitter.on("message", handler);
  }
}

export { EventNotifier };

