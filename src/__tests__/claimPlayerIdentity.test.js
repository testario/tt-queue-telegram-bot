import { jest } from "@jest/globals";
import { ClaimPlayerIdentity, PlayerIdentityClaimError } from "#application/usecases/ClaimPlayerIdentity.js";
import { QueueState } from "#domain/entities/QueueState.js";
import { InMemoryQueueRepository } from "#infrastructure/repositories/InMemoryQueueRepository.js";
import { InMemoryPlayersRepository } from "#infrastructure/players/InMemoryPlayersRepository.js";
import { updateQueueState } from "#application/usecases/queueStateCas.js";

describe("ClaimPlayerIdentity", () => {
  test("reserves, persists and activates an exact identity tuple", async () => {
    const queueRepository = new InMemoryQueueRepository();
    const playersRepository = new InMemoryPlayersRepository();
    const claim = new ClaimPlayerIdentity({ queueRepository, playersRepository });

    const result = await claim.execute({ username: "@alice", userId: 7, firstName: "Alice" });

    expect(result).toMatchObject({ ok: true, username: "@alice", userId: 7, generation: 1 });
    await expect(queueRepository.get()).resolves.toMatchObject({
      schemaVersion: 2,
      ownership: { "@alice": { userId: 7, generation: 1, status: "active" } },
    });
    await expect(playersRepository.findOne("@alice")).resolves.toMatchObject({
      userId: 7,
      generation: 1,
    });
  });

  test("same tuple retry is idempotent", async () => {
    const queueRepository = new InMemoryQueueRepository();
    const playersRepository = new InMemoryPlayersRepository();
    const claim = new ClaimPlayerIdentity({ queueRepository, playersRepository });

    const first = await claim.execute("@alice", 7);
    const second = await claim.execute("@alice", 7);

    expect(second).toMatchObject({ ok: true, generation: first.generation });
    await expect(queueRepository.get()).resolves.toMatchObject({ identityEpoch: 1 });
  });

  test("persistence failure leaves ownership pending", async () => {
    const queueRepository = new InMemoryQueueRepository();
    const playersRepository = { claimIdentity: jest.fn().mockRejectedValue(new Error("mongo unavailable")) };
    const claim = new ClaimPlayerIdentity({ queueRepository, playersRepository });

    await expect(claim.execute("@alice", 7)).rejects.toBeInstanceOf(PlayerIdentityClaimError);
    await expect(queueRepository.get()).resolves.toMatchObject({
      ownership: { "@alice": { userId: 7, generation: 1, status: "pending" } },
    });
  });

  test("partial persistence can be retried from the same pending tuple", async () => {
    const queueRepository = new InMemoryQueueRepository();
    const playersRepository = new InMemoryPlayersRepository();
    const originalClaim = playersRepository.claimIdentity.bind(playersRepository);
    let attempts = 0;
    playersRepository.claimIdentity = async (player) => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary mongo failure");
      return originalClaim(player);
    };
    const claim = new ClaimPlayerIdentity({ queueRepository, playersRepository });

    await expect(claim.execute("@alice", 7)).rejects.toBeInstanceOf(PlayerIdentityClaimError);
    const result = await claim.execute("@alice", 7);

    expect(result).toMatchObject({ ok: true, generation: 1 });
    expect(attempts).toBe(2);
  });

  test("active retry cannot reactivate a token superseded while persistence was paused", async () => {
    const queueRepository = new InMemoryQueueRepository();
    const playersRepository = new InMemoryPlayersRepository();
    const claim = new ClaimPlayerIdentity({ queueRepository, playersRepository });
    await claim.execute("@alice", 7);

    let resumePersistence;
    const persistencePaused = new Promise((resolve) => { resumePersistence = resolve; });
    playersRepository.claimIdentity = jest.fn(() => persistencePaused);
    const retry = claim.execute("@alice", 7);
    await Promise.resolve();

    await updateQueueState({
      repository: queueRepository,
      logger: { warn() {} },
      operation: "test_supersede_identity",
      mutate: (state) => {
        state.reserveIdentity("@alice", 8);
        return { state };
      },
    });
    resumePersistence({ ok: true });

    await expect(retry).rejects.toMatchObject({ reason: "superseded" });
    await expect(queueRepository.get()).resolves.toMatchObject({
      ownership: { "@alice": { userId: 8, generation: 2, status: "pending" } },
    });
  });

  test("keeps a reused username and the old owner's rename across an interleaved persist", async () => {
    const queueRepository = new InMemoryQueueRepository();
    const playersRepository = new InMemoryPlayersRepository();
    const claim = new ClaimPlayerIdentity({ queueRepository, playersRepository });
    await claim.execute("@old", 1);

    let resumeNewOwner;
    const newOwnerPersistence = new Promise((resolve) => { resumeNewOwner = resolve; });
    const originalClaim = playersRepository.claimIdentity.bind(playersRepository);
    playersRepository.claimIdentity = async (player) => {
      if (player.userId === 2) {
        await newOwnerPersistence;
      }
      return originalClaim(player);
    };

    const newOwnerClaim = claim.execute("@old", 2);
    await Promise.resolve();
    const renamedOldOwner = await claim.execute("@new", 1);
    resumeNewOwner();
    const currentNewOwner = await newOwnerClaim;

    expect(renamedOldOwner).toMatchObject({ ok: true, username: "@new", userId: 1, generation: 3 });
    expect(currentNewOwner).toMatchObject({ ok: true, username: "@old", userId: 2, generation: 2 });
    await expect(playersRepository.findOne("@old")).resolves.toMatchObject({ userId: 2, generation: 2 });
    await expect(playersRepository.findOne("@new")).resolves.toMatchObject({ userId: 1, generation: 3 });
    await expect(queueRepository.get()).resolves.toMatchObject({
      ownership: {
        "@old": { userId: 2, generation: 2, status: "active" },
        "@new": { userId: 1, generation: 3, status: "active" },
      },
    });
  });
});
