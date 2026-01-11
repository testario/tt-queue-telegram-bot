import { jest } from "@jest/globals";
import { AddMatch } from "#application/usecases/AddMatch.js";
import { templates } from "#application/messages/templates.js";
import { Match } from "#domain";
import { QueueService } from "#domain/services/QueueService.js";
import { InMemoryQueueRepository } from "#infrastructure/repositories/InMemoryQueueRepository.js";
import {
  DEFAULT_GAME_TIME,
  TIME_READY,
  WORK_SCHEDULE,
} from "#application/config/time.js";
import { QueueState } from "#domain/entities/QueueState.js";

const createRepo = (state = {}) => ({
  get: jest.fn().mockResolvedValue(state),
  save: jest.fn(),
});

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

    const result = await useCase.execute("@p1", "@p2");

    expect(result.ok).toBe(true);
    expect(queueService.scheduleMatch).toHaveBeenCalled();
    expect(repository.save).toHaveBeenCalledWith({ some: "state" });
    expect(notifier.notify).toHaveBeenCalledWith(42, expect.any(String), {
      type: "match_created",
      match: expect.objectContaining({ player1: "@p1", player2: "@p2" }),
    });
    expect(orchestrator.scheduleLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ player1: "@p1", player2: "@p2", status: Match.statuses.playing })
    );
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

    const result = await useCase.execute("@p1", "@p2", { scheduleLifecycle: false });

    expect(result.ok).toBe(true);
    expect(result.match.status).toBe(Match.statuses.waiting);
    expect(orchestrator.scheduleLifecycle).not.toHaveBeenCalled();
    expect(repository.save).toHaveBeenCalledWith({ some: "state" });
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
    const result = await addMatch.execute("@p1", "@p2");

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("player1_not_searching");
  });

  test("creates match when player is searching", async () => {
    const { state } = queueService.registerSearch(
      repository.state,
      "@p1"
    );
    repository.state = state;

    const result = await addMatch.execute("@p1", "@p2");

    expect(result.ok).toBe(true);
    expect(notifier.messages.length).toBe(1);
    expect(orchestrator.scheduled).not.toBeNull();
  });

  test("возвращает текст ошибки и не сохраняет состояние при сбое планирования", async () => {
    const failingRepository = {
      get: jest.fn().mockResolvedValue(QueueState.createEmpty()),
      save: jest.fn(),
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
    expect(failingRepository.save).not.toHaveBeenCalled();
    expect(stubNotifier.notify).not.toHaveBeenCalled();
    expect(stubOrchestrator.scheduleLifecycle).not.toHaveBeenCalled();
  });
});

