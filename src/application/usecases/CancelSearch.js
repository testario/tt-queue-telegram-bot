import { createNullLogger } from "#infrastructure/logger/Logger.js";

class CancelSearch {
  constructor({ repository, queueService, messages, logger }) {
    this.repository = repository;
    this.queueService = queueService;
    this.messages = messages;
    this.logger = logger || createNullLogger();
  }

  async execute(player) {
    this.logger.info("Запрошена отмена поиска", { player });
    const state = await this.repository.get();
    const { state: nextState, status } = this.queueService.cancelSearch(
      state,
      player
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

