import { jest } from "@jest/globals";
import { RegisterSearch } from "#application/usecases/RegisterSearch.js";
import { CancelSearch } from "#application/usecases/CancelSearch.js";
import { QueueState } from "#domain/entities/QueueState.js";
import { templates } from "#application/messages/templates.js";

describe("RegisterSearch use case", () => {
  test("сохраняет состояние и возвращает текст для добавленного игрока", async () => {
    const repository = {
      get: jest.fn().mockResolvedValue(QueueState.createEmpty()),
      save: jest.fn(),
    };
    const queueService = {
      registerSearch: jest.fn().mockReturnValue({
        state: new QueueState({ searching: ["@p1"] }),
        status: "added",
      }),
    };
    const useCase = new RegisterSearch({
      repository,
      queueService,
      messages: templates,
    });

    const result = await useCase.execute("@p1");

    expect(result.status).toBe("added");
    expect(result.text).toBe(templates.searchAdded("@p1"));
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ searching: ["@p1"] })
    );
  });

  test("возвращает текст уже в поиске без сохранения нового состояния", async () => {
    const repository = {
      get: jest.fn().mockResolvedValue(QueueState.createEmpty()),
      save: jest.fn(),
    };
    const queueService = {
      registerSearch: jest.fn().mockReturnValue({
        state: QueueState.createEmpty(),
        status: "already_searching",
      }),
    };
    const useCase = new RegisterSearch({
      repository,
      queueService,
      messages: templates,
    });

    const result = await useCase.execute("@p1");

    expect(result.status).toBe("already_searching");
    expect(result.text).toBe(templates.searchAlready("@p1"));
    expect(repository.save).toHaveBeenCalledWith(expect.any(QueueState));
  });
});

describe("CancelSearch use case", () => {
  test("возвращает текст при успешной отмене", async () => {
    const repository = {
      get: jest.fn().mockResolvedValue(QueueState.createEmpty()),
      save: jest.fn(),
    };
    const queueService = {
      cancelSearch: jest.fn().mockReturnValue({
        state: QueueState.createEmpty(),
        status: "removed",
      }),
    };
    const useCase = new CancelSearch({
      repository,
      queueService,
      messages: templates,
    });

    const result = await useCase.execute("@p1");

    expect(result.status).toBe("removed");
    expect(result.text).toBe(templates.searchCancelled());
    expect(repository.save).toHaveBeenCalled();
  });

  test("возвращает пустой текст, если игрок не найден", async () => {
    const repository = {
      get: jest.fn().mockResolvedValue(QueueState.createEmpty()),
      save: jest.fn(),
    };
    const queueService = {
      cancelSearch: jest.fn().mockReturnValue({
        state: QueueState.createEmpty(),
        status: "not_found",
      }),
    };
    const useCase = new CancelSearch({
      repository,
      queueService,
      messages: templates,
    });

    const result = await useCase.execute("@p1");

    expect(result.status).toBe("not_found");
    expect(result.text).toBeNull();
    expect(repository.save).toHaveBeenCalledWith(expect.any(QueueState));
  });
});


