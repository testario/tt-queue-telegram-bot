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
   * @param {object} [identityToken]
   * @returns {Promise<{ status: "removed" | "not_found" | "not_searching", text: string | null }>}
   */
  async execute(player, identityToken = undefined) {
    this.logger.info("Запрошена отмена поиска", { player });
    const now = this.clock.now();
    const { status } = await updateQueueState({
      repository: this.repository,
      logger: this.logger,
      operation: "cancel_search",
      mutate: (state) => {
        if (!QueueState.isCompleteIdentity(identityToken)
          || identityToken.username !== player
          || !state.isActiveIdentity(identityToken, player)) {
          return { state, status: "identity_unavailable", save: false };
        }
        return this.queueService.cancelSearch(state, player, now, { identityToken });
      },
    });

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
