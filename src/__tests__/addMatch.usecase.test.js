import { jest } from "@jest/globals";
import { AddMatch } from "#application/usecases/AddMatch.js";
import { templates } from "#application/messages/templates.js";
import { Match } from "#domain";
import { QueueService } from "#domain/services/QueueService.js";
import { InMemoryQueueRepository } from "#infrastructure/repositories/InMemoryQueueRepository.js";
import { InMemoryInvitesStore } from "#infrastructure/invites/InMemoryInvitesStore.js";
import {
  DEFAULT_GAME_TIME,
  TIME_READY,
  WORK_SCHEDULE,
} from "#application/config/time.js";
import { QueueState } from "#domain/entities/QueueState.js";

const createRepo = (state = {}) => ({
  getVersioned: jest.fn().mockResolvedValue({ state, revision: 0 }),
  saveIfRevision: jest.fn().mockResolvedValue(true),
});

const identity = (username, userId) => ({ username, userId, generation: 1, status: "active" });
const matchIdentities = {
  "@p1": identity("@p1", 1),
  "@p2": identity("@p2", 2),
};

const baseDeps = ({ matchStatus = Match.statuses.playing } = {}) => {
  const repository = createRepo();
  const queueService = {
    scheduleMatch: jest.fn().mockReturnValue({
      ok: true,
      state: { some: "state" },
      match: {
        player1: "@p1",
        player2: "@p2",
        startDate: new Date(),
        endDate: new Date(Date.now() + 1_000),
        status: matchStatus,
      },
    }),
  };
  const orchestrator = { scheduleLifecycle: jest.fn() };
  const notifier = { notify: jest.fn() };
  const clock = { now: jest.fn(() => new Date()) };

  return { repository, queueService, orchestrator, notifier, clock };
};

describe("AddMatch use case", () => {
  test("планирует жизненный цикл при статусе playing (по умолчанию)", async () => {
    const { repository, queueService, orchestrator, notifier, clock } = baseDeps();
    const useCase = new AddMatch({
      chatId: 42,
      repository,
      queueService,
      orchestrator,
      notifier,
      messages: templates,
      clock,
    });

    const result = await useCase.execute("@p1", "@p2", { participantIdentities: matchIdentities });

    expect(result.ok).toBe(true);
    expect(queueService.scheduleMatch).toHaveBeenCalled();
    expect(repository.saveIfRevision).toHaveBeenCalledWith(0, { some: "state" });
    expect(notifier.notify).toHaveBeenCalledWith(42, expect.any(String), {
      type: "match_created",
      match: expect.objectContaining({ player1: "@p1", player2: "@p2" }),
    });
    expect(orchestrator.scheduleLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ player1: "@p1", player2: "@p2", status: Match.statuses.playing })
    );
  });

  test("гасит приглашения обоих игроков (в любой роли) при создании матча", async () => {
    const { repository, queueService, orchestrator, notifier, clock } = baseDeps();
    const invitesStore = { deleteByParticipant: jest.fn().mockResolvedValue(0) };
    const useCase = new AddMatch({
      chatId: 42,
      repository,
      queueService,
      orchestrator,
      notifier,
      messages: templates,
      clock,
      invitesStore,
    });

    const result = await useCase.execute("@p1", "@p2", { participantIdentities: matchIdentities });

    expect(result.ok).toBe(true);
    // Матч мог возникнуть, пока один из игроков был стороной ещё не решённого
    // приглашения — сам позвал кого-то третьего, или сам принял чужое, пока
    // звал третьего — иначе оно осиротеет (третий игрок либо инициатор при
    // принятии упрутся в already_in_queue/тишину).
    expect(invitesStore.deleteByParticipant).toHaveBeenCalledWith({ userIds: [1, 2] });
  });

  test("не трогает хранилище приглашений, если матч не создался", async () => {
    const { repository, queueService, orchestrator, notifier, clock } = baseDeps();
    queueService.scheduleMatch.mockReturnValue({ ok: false, reason: "same_player", state: {} });
    const invitesStore = { deleteByParticipant: jest.fn() };
    const useCase = new AddMatch({
      chatId: 42,
      repository,
      queueService,
      orchestrator,
      notifier,
      messages: templates,
      clock,
      invitesStore,
    });

    const result = await useCase.execute("@p1", "@p2", { participantIdentities: matchIdentities });

    expect(result.ok).toBe(false);
    expect(invitesStore.deleteByParticipant).not.toHaveBeenCalled();
  });

  test("не падает и всё равно возвращает созданный матч, если хранилище приглашений недоступно", async () => {
    const { repository, queueService, orchestrator, notifier, clock } = baseDeps();
    const invitesStore = { deleteByParticipant: jest.fn().mockRejectedValue(new Error("storage down")) };
    const useCase = new AddMatch({
      chatId: 42,
      repository,
      queueService,
      orchestrator,
      notifier,
      messages: templates,
      clock,
      invitesStore,
      logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
    });

    const result = await useCase.execute("@p1", "@p2", { participantIdentities: matchIdentities });

    expect(result.ok).toBe(true);
  });

  test("не планирует жизненный цикл и переводит матч в waiting при паузе", async () => {
    const { repository, queueService, orchestrator, notifier, clock } = baseDeps();
    const useCase = new AddMatch({
      chatId: 42,
      repository,
      queueService,
      orchestrator,
      notifier,
      messages: templates,
      clock,
    });

    const result = await useCase.execute("@p1", "@p2", {
      scheduleLifecycle: false,
      participantIdentities: matchIdentities,
    });

    expect(result.ok).toBe(true);
    expect(result.match.status).toBe(Match.statuses.waiting);
    expect(orchestrator.scheduleLifecycle).not.toHaveBeenCalled();
    expect(repository.saveIfRevision).toHaveBeenCalledWith(0, { some: "state" });
  });
});

class StubNotifier {
  constructor() {
    this.messages = [];
  }
  notify(chatId, text) {
    this.messages.push({ chatId, text });
  }
}

class StubClock {
  now() {
    return new Date();
  }
}

class StubOrchestrator {
  constructor() {
    this.scheduled = null;
  }
  scheduleLifecycle(match) {
    this.scheduled = match;
  }
}

describe("AddMatch use case", () => {
  let repository;
  let queueService;
  let notifier;
  let orchestrator;
  let addMatch;
  let clock;

  beforeEach(() => {
    repository = new InMemoryQueueRepository();
    queueService = new QueueService({
      readyMs: TIME_READY,
      gameMs: DEFAULT_GAME_TIME,
      workSchedule: WORK_SCHEDULE,
    });
    notifier = new StubNotifier();
    orchestrator = new StubOrchestrator();
    clock = new StubClock();
    addMatch = new AddMatch({
      chatId: 1,
      repository,
      queueService,
      orchestrator,
      notifier,
      messages: templates,
      clock,
    });
  });

  test("returns error when player not searching", async () => {
    const result = await addMatch.execute("@p1", "@p2", { participantIdentities: matchIdentities });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("player1_not_searching");
  });

  test("creates match when player is searching", async () => {
    repository.state.ownership = {
      "@p1": { userId: 1, generation: 1, status: "active" },
      "@p2": { userId: 2, generation: 1, status: "active" },
    };
    const { state } = queueService.registerSearch(
      repository.state,
      "@p1",
      undefined,
      { identityToken: matchIdentities["@p1"] }
    );
    repository.state = state;

    const result = await addMatch.execute("@p1", "@p2", { participantIdentities: matchIdentities });

    expect(result.ok).toBe(true);
    expect(notifier.messages.length).toBe(1);
    expect(orchestrator.scheduled).not.toBeNull();
  });

  test("гасит чужое приглашение и снимает его зависшего инициатора с поиска, даже если игрок матча в нём — получатель, а не инициатор", async () => {
    // @third пригласил @p2 напрямую — @p2 в этом приглашении получатель, а не
    // инициатор. deleteByPlayer (ключ по инициатору) такое приглашение не
    // найдёт; матч всё равно делает его неактуальным, значит гасить надо
    // и эту роль тоже. А сам @third остаётся в общем поиске только из-за
    // этого приглашения (так же, как CreateDirectMatch регистрирует
    // инициатора) — без него это уже призрачный поиск, который надо снять
    // молча, а не оставлять его там до ручной отмены с ложным анонсом в чат.
    const invitesStore = new InMemoryInvitesStore();
    const addMatchWithInvites = new AddMatch({
      chatId: 1,
      repository,
      queueService,
      orchestrator,
      notifier,
      messages: templates,
      clock,
      invitesStore,
    });
    repository.state.ownership = {
      "@p1": { userId: 1, generation: 1, status: "active" },
      "@p2": { userId: 2, generation: 1, status: "active" },
      "@third": { userId: 3, generation: 1, status: "active" },
    };
    const thirdIdentity = identity("@third", 3);
    let state = queueService.registerSearch(
      repository.state,
      "@third",
      undefined,
      { identityToken: thirdIdentity }
    ).state;
    state = queueService.registerSearch(
      state,
      "@p1",
      undefined,
      { identityToken: matchIdentities["@p1"] }
    ).state;
    repository.state = state;
    await invitesStore.create({
      player: "@third",
      opponent: "@p2",
      playerIdentity: thirdIdentity,
      opponentIdentity: identity("@p2", 2),
      createdAt: Date.now(),
    });

    const result = await addMatchWithInvites.execute("@p1", "@p2", { participantIdentities: matchIdentities });

    expect(result.ok).toBe(true);
    expect(await invitesStore.getAll()).toEqual([]);
    expect(repository.state.searching).not.toContain("@third");
    // Роутер узнаёт, чей анонс "хочет поиграть" тоже нужно тихо убрать из
    // чата, только по этому полю — без него дыра из round 7 вернётся молча.
    expect(result.orphanedSearchers).toEqual(["@third"]);
  });

  test("atomically removes a stale search when its stored userId differs", async () => {
    repository.state = new QueueState({
      searching: ["@old"],
      searchingUserIds: { "@old": 42 },
      searchingIdentities: { "@old": identity("@old", 42) },
      ownership: {
        "@old": { userId: 99, generation: 2, status: "active" },
        "@opponent": { userId: 7, generation: 1, status: "active" },
      },
    });

    const result = await addMatch.execute("@old", "@opponent", {
      participantIdentities: {
        "@old": identity("@old", 99),
        "@opponent": identity("@opponent", 7),
      },
    });

    expect(result).toEqual(expect.objectContaining({ ok: false, reason: "player1_identity_mismatch" }));
    expect(repository.state.searching).toEqual([]);
    expect(repository.state.searchingUserIds).toEqual({});
    expect(notifier.messages).toHaveLength(0);
    expect(orchestrator.scheduled).toBeNull();
  });

  test("does not accept a participant token under another username", async () => {
    repository.state = new QueueState({
      searching: ["@victim"],
      searchingIdentities: { "@victim": identity("@victim", 2) },
      ownership: {
        "@victim": { userId: 2, generation: 1, status: "active" },
        "@opponent": { userId: 7, generation: 1, status: "active" },
        "@alice": { userId: 1, generation: 1, status: "active" },
      },
    });

    const result = await addMatch.execute("@victim", "@opponent", {
      participantIdentities: {
        "@victim": identity("@alice", 1),
        "@opponent": identity("@opponent", 7),
      },
    });

    expect(result).toEqual(expect.objectContaining({ ok: false, reason: "identity_unavailable" }));
    expect(repository.state.searching).toEqual(["@victim"]);
    expect(notifier.messages).toHaveLength(0);
  });

  test("does not perform post-save ownership validation", async () => {
    repository.state.ownership = {
      "@p1": { userId: 42, generation: 1, status: "active" },
      "@p2": { userId: 7, generation: 1, status: "active" },
    };
    const { state } = queueService.registerSearch(
      repository.state,
      "@p1",
      clock.now(),
      { identityToken: { username: "@p1", userId: 42, generation: 1, status: "active" } }
    );
    repository.state = state;
    let currentIdentity = { userId: 42, identityVersion: 1 };
    const validateParticipantIdentities = jest.fn(async () => {
      currentIdentity = { userId: 99, identityVersion: 2 };
      return false;
    });

    const result = await addMatch.execute("@p1", "@p2", {
      participantIdentities: {
        "@p1": { username: "@p1", userId: 42, generation: 1, status: "active" },
        "@p2": { username: "@p2", userId: 7, generation: 1, status: "active" },
      },
      validateParticipantIdentities,
    });

    expect(currentIdentity).toEqual({ userId: 42, identityVersion: 1 });
    expect(validateParticipantIdentities).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(repository.state.queue).toHaveLength(1);
    expect(repository.state.searching).toEqual([]);
    expect(notifier.messages).toHaveLength(1);
    expect(orchestrator.scheduled).not.toBeNull();
  });

  test("возвращает текст ошибки и не сохраняет состояние при сбое планирования", async () => {
    const failingRepository = {
      getVersioned: jest.fn().mockResolvedValue({
        state: QueueState.createEmpty(),
        revision: 0,
      }),
      saveIfRevision: jest.fn(),
    };
    const failingQueueService = {
      scheduleMatch: jest.fn().mockReturnValue({
        ok: false,
        reason: "same_player",
        state: QueueState.createEmpty(),
      }),
    };
    const stubNotifier = { notify: jest.fn() };
    const stubOrchestrator = { scheduleLifecycle: jest.fn() };
    const addMatch = new AddMatch({
      chatId: 1,
      repository: failingRepository,
      queueService: failingQueueService,
      orchestrator: stubOrchestrator,
      notifier: stubNotifier,
      messages: templates,
      clock: new StubClock(),
    });

    const result = await addMatch.execute("@p1", "@p1");

    expect(result.ok).toBe(false);
    expect(result.text).toBe(templates.matchSamePlayer());
    expect(failingRepository.saveIfRevision).not.toHaveBeenCalled();
    expect(stubNotifier.notify).not.toHaveBeenCalled();
    expect(stubOrchestrator.scheduleLifecycle).not.toHaveBeenCalled();
  });
});
