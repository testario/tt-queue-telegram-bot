import { jest } from "@jest/globals";
import { MatchOrchestrator } from "#application/services/MatchOrchestrator.js";
import { templates } from "#application/messages/templates.js";

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
    const nextMatch = createMatch("@p3", "@p4", endDate, new Date(endDate.getTime() + 5000));

    const timer = new FakeTimer();
    const notifier = { notify: jest.fn() };
    const repository = {
      get: jest.fn().mockResolvedValue({}),
      save: jest.fn(),
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
    expect(notifier.notify).toHaveBeenCalledWith(1, "started");
    expect(messages.matchStarted).toHaveBeenCalledWith(match);
    expect(timer.tasks.has(finishId)).toBe(true);

    await timer.run(finishId);

    expect(queueService.finishCurrent).toHaveBeenCalledWith({}, endDate);
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

    expect(timer.cancelled).toEqual([startId, finishId]);
  });
});


