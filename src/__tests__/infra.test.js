import { InMemoryQueueRepository } from "#infrastructure/repositories/InMemoryQueueRepository.js";
import { EventNotifier } from "#infrastructure/notifier/EventNotifier.js";
import { QueueState } from "#domain/entities/QueueState.js";

describe("InMemoryQueueRepository", () => {
  test("возвращает и сохраняет состояние в памяти", async () => {
    const initial = QueueState.createEmpty();
    const repository = new InMemoryQueueRepository(initial);

    const state = await repository.get();
    expect(state).toEqual(initial);

    const next = QueueState.createEmpty();
    await repository.save(next);
    expect(await repository.get()).toEqual(next);
  });

  test("возвращает revision и принимает только актуальный CAS", async () => {
    const repository = new InMemoryQueueRepository();
    const versioned = await repository.getVersioned();
    const next = QueueState.createEmpty();

    expect(versioned.revision).toBe(0);
    expect(await repository.saveIfRevision(versioned.revision, next)).toBe(true);
    expect((await repository.getVersioned()).revision).toBe(1);
    expect(await repository.saveIfRevision(versioned.revision, QueueState.createEmpty())).toBe(false);
  });

  test("изолирует состояние репозитория от мутаций вызывающей стороны", async () => {
    const repository = new InMemoryQueueRepository();

    const state = await repository.get();
    state.searching.push("@mutated");
    expect((await repository.get()).searching).toEqual([]);

    const versioned = await repository.getVersioned();
    versioned.state.searching.push("@versioned-mutation");
    expect((await repository.get()).searching).toEqual([]);

    const next = new QueueState({ searching: ["@saved"] });
    await repository.saveIfRevision(versioned.revision, next);
    next.searching.push("@after-save");
    expect((await repository.get()).searching).toEqual(["@saved"]);
  });
});

describe("EventNotifier", () => {
  test("проксирует сообщения через emitter", () => {
    const messages = [];
    const notifier = new EventNotifier();
    notifier.onMessage((payload) => messages.push(payload));

    notifier.notify(1, "hi");

    expect(messages).toEqual([{ chatId: 1, text: "hi" }]);
  });
});
