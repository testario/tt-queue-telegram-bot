import { createNullLogger } from "#infrastructure/logger/Logger.js";
import { updateQueueState } from "./queueStateCas.js";
import { QueueState } from "#domain/entities/QueueState.js";

/**
 * @typedef {import("#application/types.js").QueueRepository} QueueRepository
 * @typedef {import("#application/types.js").QueueService} QueueService
 * @typedef {import("#application/types.js").BotMessages} Messages
 * @typedef {import("#application/types.js").Clock} Clock
 * @typedef {import("#application/types.js").Logger} Logger
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
   * @param {object|string|number} [identityToken]
   * @returns {Promise<{ text: string, status: "added" | "already_searching" | "in_queue" | "played" | "unknown" }>}
   */
  async execute(player, identityToken = undefined) {
    this.logger.info("Игрок отправил запрос на поиск соперника", { player });
    const now = this.clock.now();
    const { status } = await updateQueueState({
      repository: this.repository,
      logger: this.logger,
      operation: "register_search",
      mutate: (state) => {
        if (!QueueState.isCompleteIdentity(identityToken)
          || identityToken.username !== player
          || !state.isActiveIdentity(identityToken, player)) {
          return { state, status: "identity_unavailable", save: false };
        }
        return this.queueService.registerSearch(state, player, now, { identityToken });
      },
    });

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
