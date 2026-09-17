import { jest } from "@jest/globals";
import { RegisterSearch } from "#application/usecases/RegisterSearch.js";
import { CancelSearch } from "#application/usecases/CancelSearch.js";
import { QueueState } from "#domain/entities/QueueState.js";
import { templates } from "#application/messages/templates.js";

const createRepository = (state) => {
  let currentState = state;
  let revision = 0;
  return {
    getVersioned: jest.fn(async () => ({ state: currentState, revision })),
    saveIfRevision: jest.fn(async (expectedRevision, nextState) => {
      if (expectedRevision !== revision) return false;
      currentState = nextState;
      revision += 1;
      return true;
    }),
  };
};

describe("RegisterSearch use case", () => {
  test("сохраняет состояние и возвращает текст для добавленного игрока", async () => {
    const repository = createRepository(QueueState.createEmpty());
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
    expect(repository.saveIfRevision).toHaveBeenCalledWith(
      0,
      expect.objectContaining({ searching: ["@p1"] })
    );
  });

  test("возвращает текст уже в поиске без сохранения нового состояния", async () => {
    const repository = createRepository(QueueState.createEmpty());
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
    expect(repository.saveIfRevision).toHaveBeenCalledWith(0, expect.any(QueueState));
  });
});

describe("CancelSearch use case", () => {
  test("возвращает текст при успешной отмене", async () => {
    const repository = createRepository(QueueState.createEmpty());
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
    expect(repository.saveIfRevision).toHaveBeenCalled();
  });

  test("возвращает пустой текст, если игрок не найден", async () => {
    const repository = createRepository(QueueState.createEmpty());
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
    expect(repository.saveIfRevision).toHaveBeenCalledWith(0, expect.any(QueueState));
  });

  test("повторяет read-modify-write после конфликта версии", async () => {
    const repository = createRepository(QueueState.createEmpty());
    repository.saveIfRevision
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
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
    expect(repository.getVersioned).toHaveBeenCalledTimes(2);
    expect(repository.saveIfRevision).toHaveBeenCalledTimes(2);
    expect(queueService.registerSearch).toHaveBeenCalledTimes(2);
  });
});
