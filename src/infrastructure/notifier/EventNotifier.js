import EventEmitter from "events";

class EventNotifier {
  constructor(emitter = new EventEmitter()) {
    this.emitter = emitter;
  }

  notify(chatId, text) {
    this.emitter.emit("message", { chatId, text });
  }

  onMessage(handler) {
    this.emitter.on("message", handler);
  }
}

export { EventNotifier };

