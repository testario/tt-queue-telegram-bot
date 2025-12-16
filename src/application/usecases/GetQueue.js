import { createNullLogger } from "#infrastructure/logger/Logger.js";

class GetQueue {
  constructor({ repository, messages, logger }) {
    this.repository = repository;
    this.messages = messages;
    this.logger = logger || createNullLogger();
  }

  async execute() {
    const state = await this.repository.get();
    this.logger.debug("Получен список очереди", { count: state.queue.length });
    return this.messages.queueList(state.queue);
  }
}

export { GetQueue };

