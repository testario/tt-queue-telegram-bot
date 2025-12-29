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
    const repository = {
      get: jest.fn().mockResolvedValue(new QueueState({ played })),
      save: jest.fn(),
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
    expect(repository.save).toHaveBeenCalledWith(expect.any(QueueState));
  });
});


