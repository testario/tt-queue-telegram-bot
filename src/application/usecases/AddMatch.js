import { createNullLogger } from "#infrastructure/logger/Logger.js";
import { Match } from "#domain";

/**
 * @typedef {import("#application/types.js").QueueRepository} QueueRepository
 * @typedef {import("#application/types.js").QueueService} QueueService
 * @typedef {import("#application/types.js").MatchLifecycle} Orchestrator
 * @typedef {import("#application/types.js").Notifier} Notifier
 * @typedef {import("#application/types.js").BotMessages} Messages
 * @typedef {import("#application/types.js").Clock} Clock
 * @typedef {import("#application/types.js").Logger} Logger
 */

/** Юзкейс создания матча и постановки его в очередь либо немедленного старта. */
class AddMatch {
  /**
   * @param {Object} deps
   * @param {string} deps.chatId
   * @param {QueueRepository} deps.repository
   * @param {QueueService} deps.queueService
   * @param {Orchestrator} deps.orchestrator
   * @param {Notifier} deps.notifier
   * @param {Messages} deps.messages
   * @param {Clock} deps.clock
   * @param {Logger} [deps.logger]
   */
  constructor({
    chatId,
    repository,
    queueService,
    orchestrator,
    notifier,
    messages,
    clock,
    logger,
  }) {
    this.chatId = chatId;
    this.repository = repository;
    this.queueService = queueService;
    this.orchestrator = orchestrator;
    this.notifier = notifier;
    this.messages = messages;
    this.clock = clock;
    this.logger = logger || createNullLogger();
  }

  /**
   * Добавляет матч между двумя игроками, уведомляет чат и при необходимости планирует таймеры.
   * @param {string} player1
   * @param {string} player2
   * @param {{ scheduleLifecycle?: boolean }} [options]
   * @returns {Promise<{ ok: true, match: Match, text: string } | { ok: false, reason?: string, text: string }>}
   */
  async execute(player1, player2, { scheduleLifecycle = true } = {}) {
    this.logger.info("Попытка создать матч", { player1, player2 });
    const state = await this.repository.get();
    const now = this.clock.now();
    const result = this.queueService.scheduleMatch(state, player1, player2, now);

    if (!result.ok) {
      this.logger.warn("Матч не создан", { player1, player2, reason: result.reason });
      return {
        ok: false,
        reason: result.reason,
        text: this.failureMessage(result.reason),
      };
    }

    const { match } = result;
    if (!scheduleLifecycle && match.status === Match.statuses.playing) {
      match.status = Match.statuses.waiting;
    }

    await this.repository.save(result.state);
    this.logger.info("Матч создан", {
      player1: match.player1,
      player2: match.player2,
      startDate: match.startDate.toISOString(),
      endDate: match.endDate.toISOString(),
      status: match.status,
    });
    const creationText = this.messages.matchCreated(match);
    this.notifier.notify(this.chatId, creationText, { type: "match_created", match });

    if (scheduleLifecycle && match.status === Match.statuses.playing) {
      this.logger.debug("Матч стартует сразу, планируем жизненный цикл", {
        player1: match.player1,
        player2: match.player2,
      });
      this.orchestrator.scheduleLifecycle(match);
    }

    return { ok: true, match, text: creationText };
  }

  /**
   * Возвращает текст ошибки для причины неудачного создания матча.
   * @param {"already_in_queue" | "already_played" | "player1_not_searching" | "same_player" | string} reason
   * @returns {string}
   */
  failureMessage(reason) {
    switch (reason) {
      case "already_in_queue":
        return this.messages.matchAlreadyInQueue();
      case "already_played":
        return this.messages.matchAlreadyPlayed();
      case "player1_not_searching":
        return this.messages.matchPlayerNotSearching();
      case "same_player":
        return this.messages.matchSamePlayer();
      default:
        return this.messages.matchAlreadyInQueue();
    }
  }
}

export { AddMatch };

