import { Match } from "#domain";
import { QueueState } from "#domain/entities/QueueState.js";
import { createNullLogger } from "#infrastructure/logger/Logger.js";

/** Завершает активный турнирный матч по подтверждению его участника. */
class FinishTournamentMatch {
  /**
   * @param {Object} deps Зависимости юзкейса.
   * @param {import("../../types.js").QueueRepository} deps.repository Репозиторий очереди.
   * @param {import("../../types.js").MatchLifecycle} deps.orchestrator Оркестратор матчей.
   * @param {import("../../types.js").Logger} [deps.logger] Логгер.
   */
  constructor({ repository, orchestrator, logger }) {
    this.repository = repository;
    this.orchestrator = orchestrator;
    this.logger = logger || createNullLogger();
    this.finishingMatchIds = new Set();
  }

  /**
   * @param {string} player Игрок, нажавший кнопку завершения.
   * @param {string} matchId Идентификатор завершаемого матча.
   * @param {object} identityToken Актуальная Telegram identity участника.
   * @returns {Promise<{ok: true}|{ok: false, reason: "not_found"|"not_tournament"|"not_participant"}>}
   */
  async execute(player, matchId, identityToken) {
    if (this.finishingMatchIds.has(matchId)) {
      return { ok: false, reason: "not_found" };
    }

    this.finishingMatchIds.add(matchId);
    try {
      const state = await this.repository.get();
      const currentMatch = state.queue[0];

      if (!currentMatch || currentMatch.id !== matchId) {
        return { ok: false, reason: "not_found" };
      }
      if (currentMatch.type !== Match.types.tournament) {
        return { ok: false, reason: "not_tournament" };
      }
      if (![currentMatch.player1, currentMatch.player2].includes(player)
        || !QueueState.sameIdentity(currentMatch.participantIdentities?.[player], identityToken)) {
        return { ok: false, reason: "not_participant" };
      }

      this.logger.info("Турнирный матч завершен участником", {
        player,
        player1: currentMatch.player1,
        player2: currentMatch.player2,
      });
      await this.orchestrator.handleMatchFinished(currentMatch);
      return { ok: true };
    } finally {
      this.finishingMatchIds.delete(matchId);
    }
  }
}

export { FinishTournamentMatch };
