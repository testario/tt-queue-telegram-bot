import { createNullLogger } from "#infrastructure/logger/Logger.js";

/** Юзкейс получения актуальной очереди матчей. */
class GetQueue {
  constructor({ repository, messages, logger }) {
    this.repository = repository;
    this.messages = messages;
    this.logger = logger || createNullLogger();
  }

  /** Возвращает текстовый список очереди и логирует её размер. */
  async execute() {
    const state = await this.repository.get();
    this.logger.debug("Получен список очереди", { count: state.queue.length });
    return this.messages.queueList(state.queue);
  }
}

export { GetQueue };

