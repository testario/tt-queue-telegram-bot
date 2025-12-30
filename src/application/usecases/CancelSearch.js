import { createNullLogger } from "#infrastructure/logger/Logger.js";

/**
 * @typedef {import("#application/types.js").QueueRepository} QueueRepository
 * @typedef {import("#application/types.js").QueueService} QueueService
 * @typedef {import("#application/types.js").BotMessages} Messages
 * @typedef {import("#application/types.js").Clock} Clock
 * @typedef {import("#application/types.js").Logger} Logger
 */

/** Юзкейс удаления игрока из поиска соперника. */
class CancelSearch {
  /**
   * @param {Object} deps
   * @param {QueueRepository} deps.repository
   * @param {QueueService} deps.queueService
   * @param {Messages} deps.messages
   * @param {Clock} [deps.clock]
   * @param {Logger} [deps.logger]
   */
  constructor({ repository, queueService, messages, clock, logger }) {
    this.repository = repository;
    this.queueService = queueService;
    this.messages = messages;
    this.clock = clock || { now: () => new Date() };
    this.logger = logger || createNullLogger();
  }

  /**
   * Удаляет игрока из поиска, сохраняет новое состояние и возвращает статус.
   * @param {string} player
   * @returns {Promise<{ status: "removed" | "not_found" | "not_searching", text: string | null }>}
   */
  async execute(player) {
    this.logger.info("Запрошена отмена поиска", { player });
    const state = await this.repository.get();
    const now = this.clock.now();
    const { state: nextState, status } = this.queueService.cancelSearch(
      state,
      player,
      now
    );
    await this.repository.save(nextState);

    if (status === "removed") {
      this.logger.info("Поиск удален", { player });
    } else {
      this.logger.debug("Запрос отмены поиска без результата", { player, status });
    }

    return {
      status,
      text: status === "removed" ? this.messages.searchCancelled() : null,
    };
  }
}

export { CancelSearch };

