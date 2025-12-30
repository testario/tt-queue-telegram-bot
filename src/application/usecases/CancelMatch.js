import { createNullLogger } from "#infrastructure/logger/Logger.js";

/**
 * @typedef {import("#domain/entities/QueueState.js").QueueState} QueueState
 * @typedef {import("#domain/entities/Match.js").Match} Match
 * @typedef {{ get: () => Promise<QueueState>, save: (state: QueueState) => Promise<void> }} QueueRepository
 * @typedef {{ cancelMatch: (state: QueueState, player: string, now: Date) => { state: QueueState, status: "not_found" | "removed_waiting" | "removed_current", removedMatch?: Match | null, nextMatch?: Match | null } }} QueueService
 * @typedef {{ cancelForMatch: (match: Match) => void, scheduleLifecycle: (match: Match) => void }} Orchestrator
 * @typedef {{ notify: (chatId: string, text: string) => void }} Notifier
 * @typedef {{ cancelCurrent: (player: string) => string, cancelWaiting: (player: string) => string, nextPair: (match: Match) => string }} Messages
 * @typedef {{ now: () => Date }} Clock
 * @typedef {{ info: Function, warn: Function, debug: Function }} Logger
 */

/** Юзкейс отмены матча текущего или будущего и пересчёта расписания. */
class CancelMatch {
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
   * Отменяет матч для игрока, уведомляет чат и управляет таймерами.
   * @param {string} player
   * @returns {Promise<{ ok: true, status: "removed_waiting" | "removed_current" } | { ok: false, reason: "not_found" }>}
   */
  async execute(player) {
    this.logger.info("Отмена матча запрошена", { player });
    const state = await this.repository.get();
    const now = this.clock.now();
    const result = this.queueService.cancelMatch(state, player, now);
    await this.repository.save(result.state);

    if (result.status === "not_found") {
      this.logger.warn("Матч для отмены не найден", { player });
      return { ok: false, reason: "not_found" };
    }

    if (result.removedMatch) {
      this.logger.info("Матч отменен", {
        player,
        player1: result.removedMatch.player1,
        player2: result.removedMatch.player2,
        status: result.status,
      });
      this.orchestrator.cancelForMatch(result.removedMatch);
    }

    if (result.status === "removed_current") {
      this.notifier.notify(this.chatId, this.messages.cancelCurrent(player));
      if (result.nextMatch) {
        this.logger.info("Продвигаем следующий матч после отмены текущего", {
          player1: result.nextMatch.player1,
          player2: result.nextMatch.player2,
        });
        this.notifier.notify(this.chatId, this.messages.nextPair(result.nextMatch));
        this.orchestrator.scheduleLifecycle(result.nextMatch);
      }
      return { ok: true, status: result.status };
    }

    this.notifier.notify(this.chatId, this.messages.cancelWaiting(player));
    return { ok: true, status: result.status };
  }
}

export { CancelMatch };

