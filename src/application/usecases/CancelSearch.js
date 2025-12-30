import { createNullLogger } from "#infrastructure/logger/Logger.js";

/**
 * @typedef {import("#domain/entities/QueueState.js").QueueState} QueueState
 * @typedef {{ get: () => Promise<QueueState>, save: (state: QueueState) => Promise<void> }} QueueRepository
 * @typedef {{ cancelSearch: (state: QueueState, player: string, now: Date) => { state: QueueState, status: "removed" | "not_found" | "not_searching" } }} QueueService
 * @typedef {{ searchCancelled: () => string }} Messages
 * @typedef {{ now: () => Date }} Clock
 * @typedef {{ info: Function, debug: Function }} Logger
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

