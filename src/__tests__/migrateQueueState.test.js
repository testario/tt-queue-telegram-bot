import { migrateQueueState } from "#application/usecases/MigrateQueueState.js";
import { InMemoryQueueRepository } from "#infrastructure/repositories/InMemoryQueueRepository.js";
import { InMemoryPlayersRepository } from "#infrastructure/players/InMemoryPlayersRepository.js";
import { QueueService } from "#domain/services/QueueService.js";
import { RegisterSearch } from "#application/usecases/RegisterSearch.js";
import { CreateDirectMatch } from "#application/usecases/CreateDirectMatch.js";
import { templates } from "#application/messages/templates.js";

describe("migrateQueueState", () => {
  test("clears legacy state once and is idempotent", async () => {
    const repository = new InMemoryQueueRepository({
      queue: [{ player1: "@old", player2: "@other", startDate: new Date(), endDate: new Date() }],
      searching: ["@old"],
      played: ["@other"],
    });

    const first = await migrateQueueState({ repository });
    const firstState = await repository.get();
    const revisionAfterMigration = repository.revision;
    const second = await migrateQueueState({ repository });

    expect(first.migrated).toBe(true);
    expect(firstState).toMatchObject({
      schemaVersion: 2,
      identityEpoch: 0,
      queue: [],
      searching: [],
      played: [],
      ownership: {},
    });
    expect(second.migrated).toBe(false);
    expect(repository.revision).toBe(revisionAfterMigration);
  });

  test("seeds epoch above legacy player generations", async () => {
    const repository = new InMemoryQueueRepository({ searching: ["@legacy"] });
    const playersRepository = new InMemoryPlayersRepository();
    await playersRepository.claimIdentity({ username: "@legacy", userId: 7, generation: 9 });

    await migrateQueueState({ repository, playersRepository });

    await expect(repository.get()).resolves.toMatchObject({ schemaVersion: 2, identityEpoch: 9 });
  });

  test("seeds current ownership from persisted player generations", async () => {
    const repository = new InMemoryQueueRepository();
    const playersRepository = new InMemoryPlayersRepository();
    await playersRepository.claimIdentity({ username: "@alice", userId: 7, generation: 4 });

    await migrateQueueState({ repository, playersRepository });

    await expect(repository.get()).resolves.toMatchObject({
      ownership: { "@alice": { userId: 7, generation: 4, status: "active" } },
    });
  });

  test("seeds only unbanned known players so a direct invite works immediately", async () => {
    const repository = new InMemoryQueueRepository();
    const playersRepository = new InMemoryPlayersRepository();
    await playersRepository.claimIdentity({ username: "@alice", userId: 7, generation: 4 });
    await playersRepository.claimIdentity({ username: "@bob", userId: 9, generation: 6 });
    await playersRepository.claimIdentity({ username: "@banned", userId: 8, generation: 5 });
    await playersRepository.banOne("@banned");

    await migrateQueueState({ repository, playersRepository });

    const state = await repository.get();
    expect(state.getActiveIdentity("@alice")).toMatchObject({
      username: "@alice",
      userId: 7,
      generation: 4,
    });
    expect(state.getActiveIdentity("@bob")).toMatchObject({ userId: 9, generation: 6 });
    expect(state.getActiveIdentity("@banned")).toBeNull();

    const queueService = new QueueService({ readyMs: 1, gameMs: 1 });
    const registerSearch = new RegisterSearch({
      repository,
      queueService,
      messages: templates,
      clock: { now: () => new Date("2026-01-01T12:00:00Z") },
    });
    const directMatch = new CreateDirectMatch({
      registerSearch,
      repository,
      queueService,
      messages: templates,
      clock: { now: () => new Date("2026-01-01T12:00:00Z") },
    });
    const initiator = state.getActiveIdentity("@alice");
    const opponent = state.getActiveIdentity("@bob");
    const result = await directMatch.execute("@alice", "@bob", {
      identityToken: initiator,
      opponentIdentity: opponent,
    });

    expect(result).toMatchObject({ ok: true, invite: { player: "@alice", opponent: "@bob" } });

  });
});
