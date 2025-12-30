import { createNullLogger } from "#infrastructure/logger/Logger.js";

/**
 * @typedef {import("#domain/entities/QueueState.js").QueueState} QueueState
 * @typedef {{ get: () => Promise<QueueState>, save: (state: QueueState) => Promise<void> }} QueueRepository
 * @typedef {{ normalizeState: (state: QueueState, now: Date) => { state: QueueState } }} QueueService
 * @typedef {{ playedList: (played: string[]) => string }} Messages
 * @typedef {{ now: () => Date }} Clock
 * @typedef {{ debug: Function }} Logger
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
    const state = await this.repository.get();
    const now = this.clock.now();
    const { state: normalizedState } = this.queueService.normalizeState(
      state,
      now
    );
    await this.repository.save(normalizedState);
    this.logger.debug("Получен список сыгравших", {
      count: normalizedState.played.length,
    });
    return this.messages.playedList(normalizedState.played);
  }
}

export { GetPlayed };

