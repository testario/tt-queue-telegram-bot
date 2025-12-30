import EventEmitter from "events";

/**
 * Уведомитель, публикующий события через `EventEmitter`.
 */
class EventNotifier {
  constructor(emitter = new EventEmitter()) {
    this.emitter = emitter;
  }

  /**
   * Отправляет сообщение подписчикам.
   * @param {number|string} chatId
   * @param {string} text
   */
  notify(chatId, text) {
    this.emitter.emit("message", { chatId, text });
  }

  /**
   * Подписывается на входящие сообщения.
   * @param {(payload: {chatId: number|string, text: string}) => void} handler
   */
  onMessage(handler) {
    this.emitter.on("message", handler);
  }
}

export { EventNotifier };

