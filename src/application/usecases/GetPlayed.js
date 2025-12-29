import { createNullLogger } from "#infrastructure/logger/Logger.js";

/** Юзкейс получения списка уже сыгравших игроков с нормализацией состояния. */
class GetPlayed {
  constructor({ repository, queueService, messages, clock, logger }) {
    this.repository = repository;
    this.queueService = queueService;
    this.messages = messages;
    this.clock = clock || { now: () => new Date() };
    this.logger = logger || createNullLogger();
  }

  /** Возвращает текстовый список сыгравших игроков, обновляя состояние при необходимости. */
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

