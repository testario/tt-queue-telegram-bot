import { CreateDirectMatch } from "#application/usecases/CreateDirectMatch.js";
import { RegisterSearch } from "#application/usecases/RegisterSearch.js";
import { QueueService } from "#domain/services/QueueService.js";
import { InMemoryQueueRepository } from "#infrastructure/repositories/InMemoryQueueRepository.js";
import { templates } from "#application/messages/templates.js";
import { DEFAULT_GAME_TIME, TIME_READY, WORK_SCHEDULE } from "#application/config/time.js";
import { QueueState } from "#domain/entities/QueueState.js";
class StubClock {
  now() {
    return new Date();
  }
}

describe("CreateDirectMatch use case", () => {
  let repository;
  let queueService;
  let clock;
  let registerSearch;
  let directMatch;

  beforeEach(() => {
    repository = new InMemoryQueueRepository();
    queueService = new QueueService({
      readyMs: TIME_READY,
      gameMs: DEFAULT_GAME_TIME,
      workSchedule: WORK_SCHEDULE,
    });
    clock = new StubClock();
    registerSearch = new RegisterSearch({
      repository,
      queueService,
      messages: templates,
      clock,
    });
    directMatch = new CreateDirectMatch({
      registerSearch,
      repository,
      queueService,
      clock,
      messages: templates,
    });
  });

  const identity = { username: "@p1", userId: 1, generation: 1, status: "active" };

  test("требует указать оппонента", async () => {
    const result = await directMatch.execute("@p1", "", { identityToken: identity });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("opponent_required");
    expect(result.text).toBe(templates.directOpponentRequired());
  });

  test("останавливается, если игрок уже играл", async () => {
    repository.state = new QueueState({ played: ["@p1"] });

    repository.state = new QueueState({
      played: ["@p1"],
      ownership: { "@p1": { userId: 1, generation: 1, status: "active" } },
    });
    const result = await directMatch.execute("@p1", "@p2", { identityToken: identity });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("played");
    expect(result.text).toBe(templates.searchPlayed("@p1"));
  });

  test("останавливается, если оппонент уже играл", async () => {
    repository.state = new QueueState({ played: ["@p2"] });

    repository.state = new QueueState({
      played: ["@p2"],
      ownership: { "@p1": { userId: 1, generation: 1, status: "active" } },
    });
    const result = await directMatch.execute("@p1", "@p2", { identityToken: identity });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("opponent_played");
    expect(result.text).toBe(templates.directOpponentPlayed("@p2"));
  });

  test("allows a new owner to reuse a username from a played match", async () => {
    const opponentIdentity = { username: "@p2", userId: 2, generation: 2, status: "active" };
    repository.state = new QueueState({
      played: ["@p2"],
      playedIdentities: [{ username: "@p2", userId: 1, generation: 1 }],
      ownership: {
        "@p1": { userId: 10, generation: 1, status: "active" },
        "@p2": { userId: 2, generation: 2, status: "active" },
      },
    });

    const result = await directMatch.execute("@p1", "@p2", {
      identityToken: { username: "@p1", userId: 10, generation: 1, status: "active" },
      opponentIdentity,
    });

    expect(result.ok).toBe(true);
  });

  test("создает матч и планирует жизненный цикл при успешном сценарии", async () => {
    repository.state = new QueueState({
      ownership: { "@p1": { userId: 1, generation: 1, status: "active" } },
    });
    const result = await directMatch.execute("@p1", "p2", { identityToken: identity });

    expect(result.ok).toBe(true);
    expect(result.invite).toEqual({
      player: "@p1",
      opponent: "@p2",
      playerIdentity: identity,
    });
    expect(repository.state.searching).toContain("@p1");
  });
});
