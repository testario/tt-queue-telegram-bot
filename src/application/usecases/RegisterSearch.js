import { createNullLogger } from "#infrastructure/logger/Logger.js";

class RegisterSearch {
  constructor({ repository, queueService, messages, logger }) {
    this.repository = repository;
    this.queueService = queueService;
    this.messages = messages;
    this.logger = logger || createNullLogger();
  }

  async execute(player) {
    this.logger.info("Игрок отправил запрос на поиск соперника", { player });
    const state = await this.repository.get();
    const { state: nextState, status } = this.queueService.registerSearch(
      state,
      player
    );
    await this.repository.save(nextState);

    this.logger.debug("Статус регистрации поиска", { player, status });
    switch (status) {
      case "added":
        return { text: this.messages.searchAdded(player), status };
      case "already_searching":
        return { text: this.messages.searchAlready(player), status };
      case "in_queue":
        return { text: this.messages.searchInQueue(player), status };
      case "played":
        return { text: this.messages.searchPlayed(player), status };
      default:
        return { text: this.messages.searchUnknown(player), status };
    }
  }
}

export { RegisterSearch };

