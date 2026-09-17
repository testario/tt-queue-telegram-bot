import { jest } from "@jest/globals";
import { GetQueue } from "#application/usecases/GetQueue.js";
import { GetPlayed } from "#application/usecases/GetPlayed.js";
import { QueueState } from "#domain/entities/QueueState.js";

describe("GetQueue use case", () => {
  test("возвращает текст очереди из шаблонов", async () => {
    const queue = [{ player1: "@p1", player2: "@p2", startDate: new Date(), endDate: new Date() }];
    const repository = {
      get: jest.fn().mockResolvedValue(new QueueState({ queue })),
    };
    const messages = { queueList: jest.fn().mockReturnValue("queue text") };
    const useCase = new GetQueue({ repository, messages });

    const result = await useCase.execute();

    expect(result).toBe("queue text");
    expect(messages.queueList).toHaveBeenCalledWith(queue);
  });
});

describe("GetPlayed use case", () => {
  test("возвращает список сыгравших", async () => {
    const played = ["@p1", "@p2"];
    let state = new QueueState({ played });
    let revision = 0;
    const repository = {
      getVersioned: jest.fn(async () => ({ state, revision })),
      saveIfRevision: jest.fn(async (expectedRevision, nextState) => {
        if (expectedRevision !== revision) return false;
        state = nextState;
        revision += 1;
        return true;
      }),
    };
    const queueService = {
      normalizeState: jest.fn((state) => ({ state })),
    };
    const messages = { playedList: jest.fn().mockReturnValue("played text") };
    const useCase = new GetPlayed({ repository, queueService, messages });

    const result = await useCase.execute();

    expect(result).toBe("played text");
    expect(messages.playedList).toHaveBeenCalledWith(played);
    expect(queueService.normalizeState).toHaveBeenCalled();
    expect(repository.saveIfRevision).toHaveBeenCalledWith(0, expect.any(QueueState));
  });

  test("повторяет нормализацию и не затирает завершение матча при CAS-конфликте", async () => {
    const lifecycleState = new QueueState({ played: ["@p1", "@p2"] });
    let state = new QueueState({ queue: [{ player1: "@p1", player2: "@p2" }] });
    let revision = 0;
    const repository = {
      getVersioned: jest.fn(async () => ({ state, revision })),
      saveIfRevision: jest.fn(async (expectedRevision, nextState) => {
        if (expectedRevision !== revision) return false;
        state = nextState;
        revision += 1;
        return true;
      }),
    };
    repository.saveIfRevision.mockImplementationOnce(async () => {
      state = lifecycleState;
      revision = 1;
      return false;
    });
    const queueService = {
      normalizeState: jest.fn((currentState) => ({ state: currentState })),
    };
    const messages = { playedList: jest.fn().mockReturnValue("played text") };
    const useCase = new GetPlayed({ repository, queueService, messages });

    await useCase.execute();

    expect(repository.getVersioned).toHaveBeenCalledTimes(2);
    expect(queueService.normalizeState).toHaveBeenCalledTimes(2);
    expect(state).toBe(lifecycleState);
    expect(state.played).toEqual(["@p1", "@p2"]);
  });
});

