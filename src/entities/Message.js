const EventEmitter = require("events");

const emitter = new EventEmitter();
class Message {
  send(text) {
    emitter.emit("message", text);
  }
}

module.exports = {emitter, Message}