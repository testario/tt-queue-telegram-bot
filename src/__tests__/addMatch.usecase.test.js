import { jest } from "@jest/globals";
import { AddMatch } from "#application/usecases/AddMatch.js";
import { QueueService } from "#domain/services/QueueService.js";
import { InMemoryQueueRepository } from "#infrastructure/repositories/InMemoryQueueRepository.js";
import { templates } from "#application/messages/templates.js";
import { DEFAULT_GAME_TIME, TIME_READY } from "#application/config/time.js";
import { QueueState } from "#domain/entities/QueueState.js";

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
    queueService = new QueueService({ readyMs: TIME_READY, gameMs: DEFAULT_GAME_TIME });
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

