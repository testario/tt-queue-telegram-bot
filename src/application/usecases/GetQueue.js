import { createNullLogger } from "#infrastructure/logger/Logger.js";

/**
 * @typedef {import("#domain/entities/QueueState.js").QueueState} QueueState
 * @typedef {{ get: () => Promise<QueueState> }} QueueRepository
 * @typedef {{ queueList: (queue: QueueState["queue"]) => string }} Messages
 * @typedef {{ debug: Function }} Logger
 */

/** Юзкейс получения актуальной очереди матчей. */
class GetQueue {
  /**
   * @param {Object} deps
   * @param {QueueRepository} deps.repository
   * @param {Messages} deps.messages
   * @param {Logger} [deps.logger]
   */
  constructor({ repository, messages, logger }) {
    this.repository = repository;
    this.messages = messages;
    this.logger = logger || createNullLogger();
  }

  /**
   * Возвращает текстовый список очереди и логирует её размер.
   * @returns {Promise<string>}
   */
  async execute() {
    const state = await this.repository.get();
    this.logger.debug("Получен список очереди", { count: state.queue.length });
    return this.messages.queueList(state.queue);
  }
}

export { GetQueue };

