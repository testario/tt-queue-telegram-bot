import { createNullLogger } from "#infrastructure/logger/Logger.js";

/**
 * @typedef {import("#domain/entities/QueueState.js").QueueState} QueueState
 * @typedef {{ get: () => Promise<QueueState>, save: (state: QueueState) => Promise<void> }} QueueRepository
 * @typedef {{ registerSearch: (state: QueueState, player: string, now: Date) => { state: QueueState, status: "added" | "already_searching" | "in_queue" | "played" | "unknown" } }} QueueService
 * @typedef {{ searchAdded: (player: string) => string, searchAlready: (player: string) => string, searchInQueue: (player: string) => string, searchPlayed: (player: string) => string, searchUnknown: (player: string) => string }} Messages
 * @typedef {{ now: () => Date }} Clock
 * @typedef {{ info: Function, debug: Function }} Logger
 */

/** Юзкейс постановки игрока в поиск соперника с учётом текущего состояния. */
class RegisterSearch {
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
   * Регистрирует запрос игрока на поиск соперника и возвращает текст результата.
   * @param {string} player
   * @returns {Promise<{ text: string, status: "added" | "already_searching" | "in_queue" | "played" | "unknown" }>}
   */
  async execute(player) {
    this.logger.info("Игрок отправил запрос на поиск соперника", { player });
    const state = await this.repository.get();
    const now = this.clock.now();
    const { state: nextState, status } = this.queueService.registerSearch(
      state,
      player,
      now
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

