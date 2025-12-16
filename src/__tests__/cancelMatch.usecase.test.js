import { jest } from "@jest/globals";
import { CancelMatch } from "#application/usecases/CancelMatch.js";
import { QueueState } from "#domain/entities/QueueState.js";
import { templates } from "#application/messages/templates.js";

const createRepo = (state = QueueState.createEmpty()) => ({
  get: jest.fn().mockResolvedValue(state),
  save: jest.fn(),
});

const createNotifier = () => ({ notify: jest.fn() });

const baseDeps = () => {
  const repository = createRepo();
  const queueService = { cancelMatch: jest.fn() };
  const orchestrator = {
    cancelForMatch: jest.fn(),
    scheduleLifecycle: jest.fn(),
  };
  const notifier = createNotifier();
  const clock = { now: jest.fn(() => new Date()) };
  return { repository, queueService, orchestrator, notifier, clock };
};

describe("CancelMatch use case", () => {
  test("возвращает ошибку, если матч не найден", async () => {
    const { repository, queueService, orchestrator, notifier, clock } = baseDeps();
    queueService.cancelMatch.mockReturnValue({
      state: QueueState.createEmpty(),
      status: "not_found",
    });
    const useCase = new CancelMatch({
      chatId: 1,
      repository,
      queueService,
      orchestrator,
      notifier,
      messages: templates,
      clock,
    });

    const result = await useCase.execute("@ghost");

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(repository.save).toHaveBeenCalledWith(expect.any(QueueState));
    expect(notifier.notify).not.toHaveBeenCalled();
    expect(orchestrator.cancelForMatch).not.toHaveBeenCalled();
  });

  test("отменяет текущий матч, уведомляет и планирует следующий", async () => {
    const { repository, queueService, orchestrator, notifier, clock } = baseDeps();
    const removedMatch = { player1: "@p1", player2: "@p2" };
    const nextMatch = { player1: "@p3", player2: "@p4" };
    queueService.cancelMatch.mockReturnValue({
      state: QueueState.createEmpty(),
      status: "removed_current",
      removedMatch,
      nextMatch,
    });
    const useCase = new CancelMatch({
      chatId: 1,
      repository,
      queueService,
      orchestrator,
      notifier,
      messages: templates,
      clock,
    });

    const result = await useCase.execute("@p1");

    expect(result).toEqual({ ok: true, status: "removed_current" });
    expect(orchestrator.cancelForMatch).toHaveBeenCalledWith(removedMatch);
    expect(notifier.notify).toHaveBeenCalledWith(1, templates.cancelCurrent("@p1"));
    expect(notifier.notify).toHaveBeenCalledWith(1, templates.nextPair(nextMatch));
    expect(orchestrator.scheduleLifecycle).toHaveBeenCalledWith(nextMatch);
  });

  test("отменяет матч в ожидании и не планирует новый", async () => {
    const { repository, queueService, orchestrator, notifier, clock } = baseDeps();
    const removedMatch = { player1: "@p1", player2: "@p2" };
    queueService.cancelMatch.mockReturnValue({
      state: QueueState.createEmpty(),
      status: "removed_waiting",
      removedMatch,
    });
    const useCase = new CancelMatch({
      chatId: 1,
      repository,
      queueService,
      orchestrator,
      notifier,
      messages: templates,
      clock,
    });

    const result = await useCase.execute("@p1");

    expect(result).toEqual({ ok: true, status: "removed_waiting" });
    expect(notifier.notify).toHaveBeenCalledWith(1, templates.cancelWaiting("@p1"));
    expect(orchestrator.scheduleLifecycle).not.toHaveBeenCalled();
  });
});


