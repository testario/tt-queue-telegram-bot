import { jest } from "@jest/globals";
import { MatchOrchestrator } from "#application/services/MatchOrchestrator.js";
import { templates } from "#application/messages/templates.js";
import { InMemoryQueueRepository } from "#infrastructure/repositories/InMemoryQueueRepository.js";
import { QueueState } from "#domain/entities/QueueState.js";

class FakeTimer {
  constructor() {
    this.tasks = new Map();
    this.cancelled = [];
  }

  schedule(id, delay, callback) {
    this.tasks.set(id, { delay, callback });
  }

  cancel(id) {
    this.cancelled.push(id);
    this.tasks.delete(id);
  }

  cancelAll() {
    Array.from(this.tasks.keys()).forEach((key) => this.cancel(key));
  }

  async run(id) {
    const task = this.tasks.get(id);
    if (task) {
      this.tasks.delete(id);
      return task.callback();
    }
  }
}

const createMatch = (player1, player2, startDate, endDate) => ({
  player1,
  player2,
  startDate,
  endDate,
  status: "waiting",
});

describe("MatchOrchestrator", () => {
  test("планирует старт и завершение матча, переходя к следующему", async () => {
    const base = new Date("2024-01-01T00:00:00.000Z");
    const startDate = new Date(base.getTime() + 1000);
    const endDate = new Date(startDate.getTime() + 5000);
    const match = createMatch("@p1", "@p2", startDate, endDate);
    match.status = "playing";
    const nextMatch = createMatch("@p3", "@p4", endDate, new Date(endDate.getTime() + 5000));

    const timer = new FakeTimer();
    const notifier = { notify: jest.fn() };
    const repository = {
      getVersioned: jest.fn().mockResolvedValue({ state: { queue: [match] }, revision: 0 }),
      saveIfRevision: jest.fn().mockResolvedValue(true),
    };
    const queueService = {
      finishCurrent: jest.fn().mockReturnValue({
        state: {},
        nextMatch,
      }),
    };
    const messages = {
      matchStarted: jest.fn(() => "started"),
      matchFinishedWithNext: jest.fn(() => "finished_with_next"),
    };
    const clock = {
      now: jest
        .fn()
        .mockReturnValueOnce(base)
        .mockReturnValueOnce(startDate)
        .mockReturnValueOnce(endDate)
        .mockReturnValue(endDate),
    };

    const orchestrator = new MatchOrchestrator({
      chatId: 1,
      timer,
      notifier,
      repository,
      queueService,
      messages,
      clock,
    });

    orchestrator.scheduleLifecycle(match);

    const startId = orchestrator.buildId("start", match);
    const finishId = orchestrator.buildId("finish", match);
    expect(timer.tasks.has(startId)).toBe(true);

    timer.run(startId);
    expect(notifier.notify).toHaveBeenCalledWith(
      1,
      "started",
      expect.objectContaining({ type: "match_started", match })
    );
    expect(messages.matchStarted).toHaveBeenCalledWith(match);
    expect(timer.tasks.has(finishId)).toBe(true);

    await timer.run(finishId);

    expect(queueService.finishCurrent).toHaveBeenCalledWith(
      { queue: [match] },
      endDate
    );
    expect(notifier.notify).toHaveBeenCalledWith(1, "finished_with_next");
    const nextStartId = orchestrator.buildId("start", nextMatch);
    expect(timer.tasks.has(nextStartId)).toBe(true);
  });

  test("cancelForMatch удаляет запланированные таймеры", () => {
    const match = createMatch("@a", "@b", new Date(), new Date());
    const timer = new FakeTimer();
    const orchestrator = new MatchOrchestrator({
      chatId: 1,
      timer,
      notifier: { notify: jest.fn() },
      repository: { get: jest.fn(), save: jest.fn() },
      queueService: { finishCurrent: jest.fn() },
      messages: templates,
      clock: { now: jest.fn(() => new Date()) },
    });

    orchestrator.scheduleLifecycle(match);
    const startId = orchestrator.buildId("start", match);
    const finishId = orchestrator.buildId("finish", match);

    orchestrator.cancelForMatch(match);

    expect(timer.cancelled).toEqual([startId, finishId, `finish-retry:@a:@b:${match.startDate.getTime()}`]);
  });

  test("не завершает новую голову старым finish callback после замены backend", async () => {
    const oldMatch = createMatch(
      "@old1",
      "@old2",
      new Date("2024-01-01T00:00:00.000Z"),
      new Date("2024-01-01T00:05:00.000Z")
    );
    oldMatch.status = "playing";
    const newMatch = createMatch(
      "@new1",
      "@new2",
      new Date("2024-01-01T00:10:00.000Z"),
      new Date("2024-01-01T00:15:00.000Z")
    );
    newMatch.status = "playing";
    const queueService = { finishCurrent: jest.fn() };
    const repository = {
      getVersioned: jest.fn().mockResolvedValue({
        state: { queue: [newMatch] },
        revision: 0,
      }),
      saveIfRevision: jest.fn(),
    };
    const orchestrator = new MatchOrchestrator({
      chatId: 1,
      timer: new FakeTimer(),
      notifier: { notify: jest.fn() },
      repository,
      queueService,
      messages: templates,
      clock: { now: jest.fn(() => new Date("2024-01-01T00:05:00.000Z")) },
    });

    await orchestrator.handleMatchFinished(oldMatch);

    expect(queueService.finishCurrent).not.toHaveBeenCalled();
    expect(repository.saveIfRevision).not.toHaveBeenCalled();
    expect((await repository.getVersioned()).state.queue[0]).toBe(newMatch);
  });

  test("CAS не затирает независимое изменение при совпадающей голове", async () => {
    const expected = createMatch(
      "@p1",
      "@p2",
      new Date("2024-01-01T00:00:00.000Z"),
      new Date("2024-01-01T00:05:00.000Z")
    );
    expected.status = "playing";
    const repository = new InMemoryQueueRepository();
    const initial = await repository.get();
    initial.enqueue(expected);
    await repository.save(initial);
    const versioned = await repository.getVersioned();
    const changed = await repository.get();
    changed.searching.push("@searching");
    await repository.save(changed);
    const raceRepository = {
      getVersioned: jest.fn().mockResolvedValue(versioned),
      saveIfRevision: (...args) => repository.saveIfRevision(...args),
    };

    const nextMatch = createMatch("@p3", "@p4", expected.endDate, new Date("2024-01-01T00:10:00.000Z"));
    const timer = new FakeTimer();
    const notifier = { notify: jest.fn() };
    const orchestrator = new MatchOrchestrator({
      chatId: 1,
      timer,
      notifier,
      repository: raceRepository,
      queueService: {
        finishCurrent: jest.fn().mockReturnValue({ state: QueueState.createEmpty(), nextMatch }),
      },
      messages: templates,
      clock: { now: jest.fn(() => expected.endDate) },
    });

    await orchestrator.handleMatchFinished(expected);

    const persisted = await repository.get();
    expect(persisted.queue[0]).toEqual(expected);
    expect(persisted.searching).toEqual(["@searching"]);
    expect(notifier.notify).not.toHaveBeenCalled();
    expect(timer.tasks.size).toBe(1);
  });

  test("повторяет завершение после временного CAS-конфликта", async () => {
    const expected = createMatch(
      "@p1",
      "@p2",
      new Date("2024-01-01T00:00:00.000Z"),
      new Date("2024-01-01T00:05:00.000Z")
    );
    expected.status = "playing";
    const state = { queue: [expected] };
    const repository = {
      getVersioned: jest
        .fn()
        .mockResolvedValueOnce({ state, revision: 0 })
        .mockResolvedValueOnce({ state, revision: 1 }),
      saveIfRevision: jest
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
    };
    const queueService = {
      finishCurrent: jest.fn().mockReturnValue({
        state: QueueState.createEmpty(),
      }),
    };
    const notifier = { notify: jest.fn() };
    const orchestrator = new MatchOrchestrator({
      chatId: 1,
      timer: new FakeTimer(),
      notifier,
      repository,
      queueService,
      messages: templates,
      clock: { now: jest.fn(() => expected.endDate) },
    });

    await orchestrator.handleMatchFinished(expected);

    expect(queueService.finishCurrent).toHaveBeenCalledTimes(2);
    expect(repository.saveIfRevision).toHaveBeenCalledTimes(2);
    expect(notifier.notify).toHaveBeenCalledTimes(1);
  });

  test("откладывает reconciliation после исчерпания CAS и не зацикливает таймер", async () => {
    const expected = createMatch(
      "@p1",
      "@p2",
      new Date("2024-01-01T00:00:00.000Z"),
      new Date("2024-01-01T00:05:00.000Z")
    );
    expected.status = "playing";
    const state = { queue: [expected] };
    const repository = {
      getVersioned: jest
        .fn()
        .mockResolvedValueOnce({ state, revision: 0 })
        .mockResolvedValueOnce({ state, revision: 1 })
        .mockResolvedValueOnce({ state, revision: 2 })
        .mockResolvedValueOnce({ state, revision: 3 })
        .mockResolvedValueOnce({ state, revision: 4 }),
      saveIfRevision: jest
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
    };
    const timer = new FakeTimer();
    const queueService = {
      finishCurrent: jest.fn().mockReturnValue({
        state: QueueState.createEmpty(),
      }),
    };
    const notifier = { notify: jest.fn() };
    const orchestrator = new MatchOrchestrator({
      chatId: 1,
      timer,
      notifier,
      repository,
      queueService,
      messages: templates,
      clock: { now: jest.fn(() => expected.endDate) },
    });

    await orchestrator.handleMatchFinished(expected);

    const retryId = orchestrator.buildId("finish-retry", expected);
    expect(timer.tasks.get(retryId).delay).toBeGreaterThan(0);
    expect(notifier.notify).not.toHaveBeenCalled();

    await timer.run(retryId);

    expect(queueService.finishCurrent).toHaveBeenCalledTimes(4);
    expect(notifier.notify).toHaveBeenCalledTimes(1);
    expect(timer.tasks.has(retryId)).toBe(false);
  });

  test("отменяет и дожидается deferred retry при dispose", async () => {
    const expected = createMatch(
      "@p1",
      "@p2",
      new Date("2024-01-01T00:00:00.000Z"),
      new Date("2024-01-01T00:05:00.000Z")
    );
    expected.status = "playing";
    const state = { queue: [expected] };
    const repository = {
      getVersioned: jest.fn().mockResolvedValue(state).mockImplementation(async () => ({ state, revision: 0 })),
      saveIfRevision: jest.fn().mockResolvedValue(false),
    };
    const timer = new FakeTimer();
    const orchestrator = new MatchOrchestrator({
      chatId: 1,
      timer,
      notifier: { notify: jest.fn() },
      repository,
      queueService: { finishCurrent: jest.fn().mockReturnValue({ state: QueueState.createEmpty() }) },
      messages: templates,
      clock: { now: jest.fn(() => expected.endDate) },
    });

    await orchestrator.handleMatchFinished(expected);
    const retryId = orchestrator.buildId("finish-retry", expected);
    expect(timer.tasks.has(retryId)).toBe(true);

    await orchestrator.dispose();

    expect(timer.tasks.size).toBe(0);
  });

  test("обрабатывает rejection deferred retry без unhandled rejection", async () => {
    const expected = createMatch(
      "@p1",
      "@p2",
      new Date("2024-01-01T00:00:00.000Z"),
      new Date("2024-01-01T00:05:00.000Z")
    );
    expected.status = "playing";
    const state = { queue: [expected] };
    const error = new Error("redis unavailable");
    const repository = {
      getVersioned: jest
        .fn()
        .mockResolvedValueOnce({ state, revision: 0 })
        .mockResolvedValueOnce({ state, revision: 1 })
        .mockResolvedValueOnce({ state, revision: 2 })
        .mockResolvedValueOnce({ state, revision: 3 })
        .mockRejectedValueOnce(error),
      saveIfRevision: jest.fn().mockResolvedValue(false),
    };
    const timer = new FakeTimer();
    const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
    const onRejected = jest.fn();
    const orchestrator = new MatchOrchestrator({
      chatId: 1,
      timer,
      notifier: { notify: jest.fn() },
      repository,
      queueService: { finishCurrent: jest.fn().mockReturnValue({ state: QueueState.createEmpty() }) },
      messages: templates,
      clock: { now: jest.fn(() => expected.endDate) },
      logger,
    });
    orchestrator.setAsyncTaskHooks({ onRejected });

    await orchestrator.handleMatchFinished(expected);
    const retryId = orchestrator.buildId("finish-retry", expected);
    await timer.run(retryId);

    expect(onRejected).toHaveBeenCalledWith(error);
    expect(logger.error).toHaveBeenCalledWith(
      "Ошибка async-задачи lifecycle таймера",
      { message: error.message }
    );
    await orchestrator.dispose();
  });

  test("не ставит deferred timer, если head изменилась после конфликтов CAS", async () => {
    const expected = createMatch(
      "@p1",
      "@p2",
      new Date("2024-01-01T00:00:00.000Z"),
      new Date("2024-01-01T00:05:00.000Z")
    );
    expected.status = "playing";
    const changedHead = createMatch(
      "@p3",
      "@p4",
      expected.endDate,
      new Date("2024-01-01T00:10:00.000Z")
    );
    changedHead.status = "playing";
    const repository = {
      getVersioned: jest
        .fn()
        .mockResolvedValueOnce({ state: { queue: [expected] }, revision: 0 })
        .mockResolvedValueOnce({ state: { queue: [expected] }, revision: 1 })
        .mockResolvedValueOnce({ state: { queue: [expected] }, revision: 2 })
        .mockResolvedValueOnce({ state: { queue: [changedHead] }, revision: 3 }),
      saveIfRevision: jest.fn().mockResolvedValue(false),
    };
    const timer = new FakeTimer();
    const orchestrator = new MatchOrchestrator({
      chatId: 1,
      timer,
      notifier: { notify: jest.fn() },
      repository,
      queueService: {
        finishCurrent: jest.fn().mockReturnValue({
          state: QueueState.createEmpty(),
        }),
      },
      messages: templates,
      clock: { now: jest.fn(() => expected.endDate) },
    });

    await orchestrator.handleMatchFinished(expected);

    expect(timer.tasks.size).toBe(0);
  });

  test("изменение status блокирует завершение, а только playing head завершается", async () => {
    const expected = createMatch(
      "@p1",
      "@p2",
      new Date("2024-01-01T00:00:00.000Z"),
      new Date("2024-01-01T00:05:00.000Z")
    );
    expected.status = "playing";
    const storedWaiting = { ...expected, status: "waiting" };
    const waitingRepository = new InMemoryQueueRepository();
    const waitingState = await waitingRepository.get();
    waitingState.enqueue(storedWaiting);
    await waitingRepository.save(waitingState);
    const waitingQueueService = { finishCurrent: jest.fn() };
    const waitingNotifier = { notify: jest.fn() };
    const waitingOrchestrator = new MatchOrchestrator({
      chatId: 1,
      timer: new FakeTimer(),
      notifier: waitingNotifier,
      repository: waitingRepository,
      queueService: waitingQueueService,
      messages: templates,
      clock: { now: jest.fn(() => expected.endDate) },
    });

    await waitingOrchestrator.handleMatchFinished(expected);
    expect(waitingQueueService.finishCurrent).not.toHaveBeenCalled();
    expect(waitingNotifier.notify).not.toHaveBeenCalled();
  });

  test("scheduleNext:false сохраняет результат, но не планирует следующую пару", async () => {
    const expected = createMatch(
      "@p1",
      "@p2",
      new Date("2024-01-01T00:00:00.000Z"),
      new Date("2024-01-01T00:05:00.000Z")
    );
    expected.status = "playing";
    const nextMatch = createMatch("@p3", "@p4", expected.endDate, new Date("2024-01-01T00:10:00.000Z"));
    nextMatch.status = "playing";
    const repository = new InMemoryQueueRepository();
    const state = await repository.get();
    state.enqueue(expected);
    await repository.save(state);
    const timer = new FakeTimer();
    const orchestrator = new MatchOrchestrator({
      chatId: 1,
      timer,
      notifier: { notify: jest.fn() },
      repository,
      queueService: {
        finishCurrent: jest.fn().mockReturnValue({ state: QueueState.createEmpty(), nextMatch }),
      },
      messages: templates,
      clock: { now: jest.fn(() => expected.endDate) },
    });

    await orchestrator.handleMatchFinished(expected, { scheduleNext: false });

    expect(timer.tasks.size).toBe(0);
  });

  test("безопасно обрабатывает rejection timer task и уведомляет reconciler", async () => {
    const timer = new FakeTimer();
    const error = new Error("redis unavailable");
    const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
    const onRejected = jest.fn();
    const match = createMatch("@p1", "@p2", new Date(), new Date(Date.now() + 1000));
    match.status = "playing";
    const orchestrator = new MatchOrchestrator({
      chatId: 1,
      timer,
      notifier: { notify: jest.fn() },
      repository: { getVersioned: jest.fn().mockRejectedValue(error) },
      queueService: { finishCurrent: jest.fn() },
      messages: templates,
      clock: { now: jest.fn(() => new Date()) },
      logger,
    });
    orchestrator.setAsyncTaskHooks({ onRejected });
    orchestrator.scheduleFinish(match);

    await timer.run(orchestrator.buildId("finish", match));

    expect(logger.error).toHaveBeenCalledWith(
      "Ошибка async-задачи lifecycle таймера",
      { message: error.message }
    );
    expect(onRejected).toHaveBeenCalledWith(error);
    await orchestrator.dispose();
    expect(timer.tasks.size).toBe(0);
  });

  test("rejects scheduling after disposal and cannot revive from a start callback", async () => {
    const timer = new FakeTimer();
    const match = createMatch(
      "@p1",
      "@p2",
      new Date("2024-01-01T00:00:00.000Z"),
      new Date("2024-01-01T00:05:00.000Z")
    );
    match.status = "playing";
    const orchestrator = new MatchOrchestrator({
      chatId: 1,
      timer,
      notifier: {
        notify: jest.fn(() => {
          void orchestrator.dispose();
        }),
      },
      repository: {},
      queueService: {},
      messages: { matchStarted: jest.fn(() => "started") },
      clock: { now: jest.fn(() => new Date("2024-01-01T00:00:00.000Z")) },
    });

    orchestrator.scheduleLifecycle(match);
    await timer.run(orchestrator.buildId("start", match));
    await orchestrator.dispose();

    expect(timer.tasks.size).toBe(0);
    orchestrator.scheduleLifecycle(match);
    orchestrator.scheduleFinish(match);
    expect(timer.tasks.size).toBe(0);
  });
});
