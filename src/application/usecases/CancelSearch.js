import { createNullLogger } from "#infrastructure/logger/Logger.js";

/** Юзкейс удаления игрока из поиска соперника. */
class CancelSearch {
  constructor({ repository, queueService, messages, clock, logger }) {
    this.repository = repository;
    this.queueService = queueService;
    this.messages = messages;
    this.clock = clock || { now: () => new Date() };
    this.logger = logger || createNullLogger();
  }

  /** Удаляет игрока из поиска, сохраняет новое состояние и возвращает статус. */
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

