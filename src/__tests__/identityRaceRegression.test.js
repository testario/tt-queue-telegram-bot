import { jest } from "@jest/globals";
import { AddMatch } from "#application/usecases/AddMatch.js";
import { RegisterSearch } from "#application/usecases/RegisterSearch.js";
import { QueueService } from "#domain/services/QueueService.js";
import { QueueState } from "#domain/entities/QueueState.js";
import { InMemoryQueueRepository } from "#infrastructure/repositories/InMemoryQueueRepository.js";
import { templates } from "#application/messages/templates.js";

const identity = (username, userId, generation = 1) => ({ username, userId, generation });

const repositoryWithBanInterleaving = async (state, userId) => {
  const inner = new InMemoryQueueRepository(state);
  let fenced = false;
  return {
    inner,
    getVersioned: (...args) => inner.getVersioned(...args),
    saveIfRevision: async (revision, nextState) => {
      if (!fenced) {
        fenced = true;
        const current = await inner.getVersioned();
        current.state.setBannedIdentity(userId, true);
        await inner.saveIfRevision(current.revision, current.state);
      }
      return inner.saveIfRevision(revision, nextState);
    },
  };
};

describe("identity race regressions", () => {
  test("a search that passed its pre-ban read is fenced before persistence", async () => {
    const player = identity("@alice", 1);
    const repository = await repositoryWithBanInterleaving(new QueueState({
      ownership: { "@alice": { ...player, status: "active" } },
    }), 1);
    const queueService = new QueueService({ readyMs: 1, gameMs: 1 });
    const registerSearch = new RegisterSearch({
      repository,
      queueService,
      messages: templates,
      clock: { now: () => new Date("2026-01-01T12:00:00Z") },
    });

    const result = await registerSearch.execute("@alice", player);

    expect(result.status).toBe("player_banned");
    await expect(repository.inner.get()).resolves.toMatchObject({ searching: [], queue: [] });
  });

  test("a match that passed its pre-ban read is fenced before persistence", async () => {
    const alice = identity("@alice", 1);
    const bob = identity("@bob", 2);
    const repository = await repositoryWithBanInterleaving(new QueueState({
      searching: ["@alice"],
      searchingUserIds: { "@alice": 1 },
      searchingIdentities: { "@alice": alice },
      ownership: {
        "@alice": { ...alice, status: "active" },
        "@bob": { ...bob, status: "active" },
      },
    }), 1);
    const queueService = new QueueService({ readyMs: 1, gameMs: 1 });
    const addMatch = new AddMatch({
      chatId: "queue",
      repository,
      queueService,
      orchestrator: { scheduleLifecycle: jest.fn(), cancelForMatch: jest.fn() },
      notifier: { notify: jest.fn() },
      messages: templates,
      clock: { now: () => new Date("2026-01-01T12:00:00Z") },
    });

    const result = await addMatch.execute("@alice", "@bob", {
      participantIdentities: { "@alice": alice, "@bob": bob },
    });

    expect(result).toMatchObject({ ok: false, reason: "player_banned" });
    await expect(repository.inner.get()).resolves.toMatchObject({ queue: [] });
  });
});
