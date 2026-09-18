import { createNullLogger } from "#infrastructure/logger/Logger.js";
import { updateQueueState } from "./queueStateCas.js";

/** Ошибка claim: pending ownership намеренно остаётся в QueueState. */
export class PlayerIdentityClaimError extends Error {
  constructor(message, token = null, reason = "claim_failed", transitions = []) {
    super(message);
    this.name = "PlayerIdentityClaimError";
    this.token = token;
    this.reason = reason;
    this.transitions = transitions;
  }
}

/**
 * Reserve → persist → activate identity claim.
 * Mongo/InMemory persistence is guarded by the same generation as QueueState.
 */
export class ClaimPlayerIdentity {
  constructor({ queueRepository, playersRepository, logger }) {
    this.queueRepository = queueRepository;
    this.playersRepository = playersRepository;
    this.logger = logger || createNullLogger();
  }

  async execute(input, userId, profile = {}) {
    const claim = typeof input === "object"
      ? input
      : { ...profile, username: input, userId };
    const { username, firstName, lastName } = claim;
    const resolvedUserId = claim.userId;
    let token = null;
    let transitions = [];
    const cleanupIdentities = (includeToken = false) => [
      ...transitions,
      ...(includeToken && token ? [token] : []),
    ].filter((identity, index, all) => all.findIndex((candidate) =>
      candidate.username === identity.username
      && String(candidate.userId) === String(identity.userId)
      && Number(candidate.generation) === Number(identity.generation)
    ) === index);

    const reserved = await updateQueueState({
      repository: this.queueRepository,
      logger: this.logger,
      operation: "claim_player_identity_reserve",
      mutate: (state) => {
        token = state.reserveIdentity(username, resolvedUserId);
        transitions = state.lastIdentityTransitions || [];
        return { state, token };
      },
    });
    token = reserved.token || token;

    try {
      const persisted = typeof this.playersRepository.claimIdentity === "function"
        ? await this.playersRepository.claimIdentity({
            username,
            userId: resolvedUserId,
            generation: token.generation,
            firstName,
            lastName,
          })
        : await this.playersRepository.upsert({
            username,
            userId: resolvedUserId,
            generation: token.generation,
            firstName,
            lastName,
          });
      if (persisted === false || persisted?.ok === false) {
        throw new PlayerIdentityClaimError(
          "player identity generation is stale",
          token,
          "claim_failed",
          cleanupIdentities()
        );
      }
    } catch (error) {
      this.logger.error("Не удалось сохранить claim identity", {
        username,
        userId: resolvedUserId,
        generation: token.generation,
        message: error.message,
      });
      if (error instanceof PlayerIdentityClaimError) throw error;
      throw new PlayerIdentityClaimError(
        error.message,
        token,
        error.reason || "claim_failed",
        cleanupIdentities()
      );
    }

    const activated = await updateQueueState({
      repository: this.queueRepository,
      logger: this.logger,
      operation: "claim_player_identity_activate",
      mutate: (state) => {
        const result = state.activateIdentity(token);
        if (!result.ok || result.save === false) return { save: false, ...result, token };
        return { state, ...result, token };
      },
    });
    if (activated.ok === false) {
      const reason = activated.reason === "player_banned" ? "player_banned" : "superseded";
      throw new PlayerIdentityClaimError(
        reason === "player_banned" ? "player is banned" : "identity activation token is stale",
        token,
        reason,
        cleanupIdentities(true),
      );
    }

    const result = { ok: true, ...token, status: "active" };
    Object.defineProperty(result, "transitions", {
      value: transitions,
      enumerable: false,
    });
    return result;
  }
}
