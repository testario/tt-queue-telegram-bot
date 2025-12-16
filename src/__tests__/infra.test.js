import { InMemoryQueueRepository } from "#infrastructure/repositories/InMemoryQueueRepository.js";
import { EventNotifier } from "#infrastructure/notifier/EventNotifier.js";
import { QueueState } from "#domain/entities/QueueState.js";

describe("InMemoryQueueRepository", () => {
  test("возвращает и сохраняет состояние в памяти", async () => {
    const initial = QueueState.createEmpty();
    const repository = new InMemoryQueueRepository(initial);

    const state = await repository.get();
    expect(state).toBe(initial);

    const next = QueueState.createEmpty();
    await repository.save(next);
    expect(await repository.get()).toBe(next);
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


