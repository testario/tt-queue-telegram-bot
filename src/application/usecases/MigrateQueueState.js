import { createNullLogger } from "#infrastructure/logger/Logger.js";
import { QueueState } from "#domain/entities/QueueState.js";
import { updateQueueState } from "./queueStateCas.js";

/**
 * Idempotently migrates the durable queue before any handler or timer starts.
 * Legacy participant identity cannot be proved, so queue/search/played/match
 * state is discarded rather than carried into the v2 ownership model.
 */
export async function migrateQueueState({ repository, playersRepository, logger }) {
  return updateQueueState({
    repository,
    logger: logger || createNullLogger(),
    operation: "migrate_queue_state_v2",
    mutate: async (state) => {
      await playersRepository?.migrateIdentityGenerations?.();

      let highestKnownGeneration = 0;
      let knownPlayers = [];
      if (playersRepository?.findAll) {
        knownPlayers = await playersRepository.findAll();
        highestKnownGeneration = Math.max(
          0,
          ...knownPlayers.map((player) => Math.max(
            Number(player.generation) || 0,
            Number(player.identityVersion) || 0,
          )),
        );
      }

      const knownOwnership = new Map();
      const knownBannedUserIds = {};
      for (const player of knownPlayers) {
        if (player.banned === true && player.userId != null) {
          knownBannedUserIds[String(player.userId)] = { banned: true };
        }

        const generation = Number(player.generation ?? player.identityVersion);
        if (player.banned === true || !player.username || player.userId == null
          || !Number.isSafeInteger(generation) || generation < 1) continue;
        knownOwnership.set(player.username, {
          userId: player.userId,
          generation,
          status: "active",
        });
      }

      if (QueueState.isLegacy(state)) {
        // Legacy participant identity cannot be proved. Clear it, but retain
        // durable player ownership and ban fences discovered above.
        return {
          state: QueueState.createEmpty({
            identityEpoch: highestKnownGeneration,
            ownership: Object.fromEntries(knownOwnership),
            bannedUserIds: knownBannedUserIds,
          }),
          migrated: true,
        };
      }

      const missingOwnership = [...knownOwnership]
        .some(([username]) => !state.ownership[username]);
      const missingBannedUserIds = Object.keys(knownBannedUserIds)
        .some((userId) => !state.bannedUserIds[userId]);
      if (state.identityEpoch >= highestKnownGeneration
        && !missingOwnership && !missingBannedUserIds) {
        return { save: false, migrated: false, state };
      }

      const nextState = state.clone();
      nextState.identityEpoch = highestKnownGeneration;
      nextState.bannedUserIds = {
        ...nextState.bannedUserIds,
        ...knownBannedUserIds,
      };
      for (const [username, identity] of knownOwnership) {
        if (!nextState.ownership[username] && !nextState.identityTombstones[username]) {
          nextState.ownership[username] = identity;
        }
      }
      return { state: nextState, migrated: false, seededEpoch: true };
    },
  });
}
