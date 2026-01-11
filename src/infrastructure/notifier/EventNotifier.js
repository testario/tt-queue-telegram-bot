import EventEmitter from "events";

/**
 * Уведомитель, публикующий события через `EventEmitter`.
 */
/**
 * @implements {import("#application/types.js").Notifier}
 */
class EventNotifier {
  constructor(emitter = new EventEmitter()) {
    this.emitter = emitter;
  }

  /**
   * Отправляет сообщение подписчикам.
   * @param {number|string} chatId
   * @param {string} text
   * @param {Record<string, unknown>} [meta]
   */
  notify(chatId, text, meta = undefined) {
    this.emitter.emit("message", { chatId, text, meta });
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

