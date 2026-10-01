import { Match } from "#domain";
import { QueueState } from "#domain/entities/QueueState.js";
import { createNullLogger } from "#infrastructure/logger/Logger.js";

/** Завершает активный турнирный матч по подтверждению участника или администратора. */
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
   * @param {string} player Пользователь, нажавший кнопку завершения.
   * @param {string} matchId Идентификатор завершаемого матча.
   * @param {{ identityToken?: object, isAdmin?: boolean }|object} [options] Identity участника или права администратора.
   * @returns {Promise<{ok: true}|{ok: false, reason: "not_found"|"not_tournament"|"not_participant"}>}
   */
  async execute(player, matchId, options = {}) {
    const isAdmin = options.isAdmin === true;
    const identityToken = isAdmin ? options.identityToken : options.identityToken || options;
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
      const isParticipant = [currentMatch.player1, currentMatch.player2].includes(player);
      const hasMatchingIdentity = QueueState.sameIdentity(
        currentMatch.participantIdentities?.[player],
        identityToken
      );
      if (!isAdmin && (!isParticipant || !hasMatchingIdentity)) {
        return { ok: false, reason: "not_participant" };
      }

      this.logger.info("Турнирный матч завершен", {
        player,
        isAdmin,
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
