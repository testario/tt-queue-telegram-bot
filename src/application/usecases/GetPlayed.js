import { createNullLogger } from "#infrastructure/logger/Logger.js";

class GetPlayed {
  constructor({ repository, messages, logger }) {
    this.repository = repository;
    this.messages = messages;
    this.logger = logger || createNullLogger();
  }

  async execute() {
    const state = await this.repository.get();
    this.logger.debug("Получен список сыгравших", { count: state.played.length });
    return this.messages.playedList(state.played);
  }
}

export { GetPlayed };

