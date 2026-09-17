import { createNullLogger } from "#infrastructure/logger/Logger.js";
import { updateQueueState } from "./queueStateCas.js";

/**
 * @typedef {import("#application/types.js").QueueRepository} QueueRepository
 * @typedef {import("#application/types.js").QueueService} QueueService
 * @typedef {import("#application/types.js").BotMessages} Messages
 * @typedef {import("#application/types.js").Clock} Clock
 * @typedef {import("#application/types.js").Logger} Logger
 */

/** Юзкейс получения списка уже сыгравших игроков с нормализацией состояния. */
class GetPlayed {
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
   * Возвращает текстовый список сыгравших игроков, обновляя состояние при необходимости.
   * @returns {Promise<string>}
   */
  async execute() {
    const now = this.clock.now();
    const { state: normalizedState } = await updateQueueState({
      repository: this.repository,
      logger: this.logger,
      operation: "normalize_get_played_state",
      mutate: (state) => this.queueService.normalizeState(state, now),
    });
    this.logger.debug("Получен список сыгравших", {
      count: normalizedState.played.length,
    });
    return this.messages.playedList(normalizedState.played);
  }
}

export { GetPlayed };
