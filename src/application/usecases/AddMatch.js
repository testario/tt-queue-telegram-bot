import { createNullLogger } from "#infrastructure/logger/Logger.js";
import { Match, QueueState } from "#domain";
import { updateQueueState } from "./queueStateCas.js";

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
   * @param {import("#application/types.js").InvitesStore} [deps.invitesStore]
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
    invitesStore,
  }) {
    this.chatId = chatId;
    this.repository = repository;
    this.queueService = queueService;
    this.orchestrator = orchestrator;
    this.notifier = notifier;
    this.messages = messages;
    this.clock = clock;
    this.logger = logger || createNullLogger();
    this.invitesStore = invitesStore || null;
  }

  /**
   * Добавляет матч между двумя игроками, уведомляет чат и при необходимости планирует таймеры.
   * @param {string} player1
   * @param {string} player2
   * @param {{ scheduleLifecycle?: boolean, participantIdentities: Record<string, object>, inviteIdentities?: Record<string, object> }} options
   * @returns {Promise<
   *   | { ok: true, match: Match, text: string, orphanedSearchers: string[] }
   *   | { ok: false, reason?: string, text: string }
   * >}
   */
  async execute(
    player1,
    player2,
    {
      scheduleLifecycle = true,
      participantIdentities = {},
      inviteIdentities = {},
    } = {}
  ) {
    this.logger.info("Попытка создать матч", { player1, player2 });
    const now = this.clock.now();
    const { result, match } = await updateQueueState({
      repository: this.repository,
      logger: this.logger,
      operation: "add_match",
      mutate: (state) => {
        const result = this.queueService.scheduleMatch(
          state,
          player1,
          player2,
          now,
          { participantIdentities, inviteIdentities }
        );
        if (!result.ok) return { state: result.state, result, match: null, save: result.cleanup === true };

        const { match } = result;
        if (!scheduleLifecycle && match.status === Match.statuses.playing) {
          match.status = Match.statuses.waiting;
        }
        return { state: result.state, result, match };
      },
    });

    if (!result.ok) {
      this.logger.warn("Матч не создан", { player1, player2, reason: result.reason });
      return {
        ok: false,
        reason: result.reason,
        text: this.failureMessage(result.reason),
      };
    }

    this.logger.info("Матч создан", {
      player1: match.player1,
      player2: match.player2,
      startDate: match.startDate.toISOString(),
      endDate: match.endDate.toISOString(),
      status: match.status,
    });
    // Матч мог возникнуть, пока один из игроков был стороной какого-то ещё не
    // решённого прямого приглашения — сам его отправил (общий поиск или
    // "Сыграть с ним" поверх зависшего исходящего приглашения) или сам его
    // получил (принял чужое приглашение, пока звал кого-то третьего). Играть
    // с двумя партнёрами одновременно нельзя — гасим такое приглашение в
    // любой из двух ролей, иначе оно осиротеет и третий игрок либо инициатор
    // наткнутся на already_in_queue/тишину при попытке его принять.
    // Возвращаем инициаторов таких погашенных приглашений вызывающему коду:
    // их анонс "хочет поиграть" в чате (если он был) тоже надо тихо убрать —
    // сам AddMatch о нём ничего не знает, это забота webapp-роутера.
    const orphanedSearchers = await this.discardStaleInvites(match.player1, match.player2, participantIdentities);
    const creationText = this.messages.matchCreated(match);
    this.notifier.notify(this.chatId, creationText, { type: "match_created", match });

    if (scheduleLifecycle && match.status === Match.statuses.playing) {
      this.logger.debug("Матч стартует сразу, планируем жизненный цикл", {
        player1: match.player1,
        player2: match.player2,
      });
      this.orchestrator.scheduleLifecycle(match);
    }

    return { ok: true, match, text: creationText, orphanedSearchers };
  }

  /**
   * Гасит любое прямое приглашение, где один из игроков матча участвует
   * хоть инициатором, хоть получателем — лучший эффорт, ошибки хранилища
   * не должны ломать уже созданный матч. Матчится по userId, а не по
   * username/generation, чтобы не пропустить приглашение после смены ника.
   *
   * Если погашенное приглашение звал кто-то третий (не сам матч), этот
   * третий остаётся висеть в общем поиске — он попал туда только из-за
   * своего приглашения (см. CreateDirectMatch), и без него это уже
   * "призрачный" поиск: молча, без анонса, снимаем и его тоже, иначе он
   * потом либо застрянет в списке ищущих навсегда, либо при собственной
   * отмене поиска получит фейковый анонс "Игрок передумал" в чат — том
   * самом чате, которому вообще не полагалось знать об этом приглашении.
   * @param {string} player1
   * @param {string} player2
   * @param {Record<string, { userId?: string|number }>} participantIdentities
   * @returns {Promise<string[]>} Инициаторы погашенных приглашений, снятые с поиска.
   */
  async discardStaleInvites(player1, player2, participantIdentities) {
    if (!this.invitesStore || typeof this.invitesStore.deleteByParticipant !== "function") return [];
    const userIds = [participantIdentities?.[player1]?.userId, participantIdentities?.[player2]?.userId]
      .filter((userId) => userId !== undefined && userId !== null);
    if (!userIds.length) return [];
    const orphanedSearchers = [];
    try {
      const staleInvites = typeof this.invitesStore.getAll === "function"
        ? await this.invitesStore.getAll()
        : [];
      const matchedUserIds = new Set(userIds.map(String));
      const affected = staleInvites.filter((invite) =>
        matchedUserIds.has(String(invite.playerIdentity?.userId))
        || matchedUserIds.has(String(invite.opponentIdentity?.userId))
      );

      await this.invitesStore.deleteByParticipant({ userIds });

      const matchedPlayers = new Set([player1, player2]);
      for (const invite of affected) {
        if (!matchedPlayers.has(invite.player)) {
          await this.discardOrphanedSearch(invite.player, invite.playerIdentity);
          orphanedSearchers.push(invite.player);
        }
      }
    } catch (err) {
      this.logger.error("Не удалось погасить приглашения игроков при создании матча", {
        player1,
        player2,
        message: err.message,
      });
    }
    return orphanedSearchers;
  }

  /**
   * Снимает игрока с общего поиска, если его исходящее приглашение только что
   * погашено чужим матчем — лучший эффорт с провалившейся/чужой identity
   * (identityToken уже мог устареть) просто ничего не меняет.
   * @param {string} player
   * @param {object} identityToken
   */
  async discardOrphanedSearch(player, identityToken) {
    try {
      await updateQueueState({
        repository: this.repository,
        logger: this.logger,
        operation: "discard_orphaned_invite_search",
        mutate: (state) => {
          if (!QueueState.isCompleteIdentity(identityToken)
            || identityToken.username !== player
            || !state.isActiveIdentity(identityToken, player)) {
            return { state, save: false };
          }
          return this.queueService.cancelSearch(state, player, this.clock.now(), { identityToken });
        },
      });
    } catch (err) {
      this.logger.error("Не удалось снять зависшего инициатора приглашения с поиска", {
        player,
        message: err.message,
      });
    }
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
      case "player1_identity_mismatch":
        return this.messages.matchPlayerNotSearching();
      case "identity_unavailable":
        return this.messages.matchPlayerNotSearching();
      case "identity_changed":
        return this.messages.matchPlayerNotSearching();
      default:
        return this.messages.matchAlreadyInQueue();
    }
  }
}

export { AddMatch };
