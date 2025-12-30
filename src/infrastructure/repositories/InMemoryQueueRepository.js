import { QueueState } from "#domain/entities/QueueState.js";

/**
 * Хранит состояние очереди в памяти процесса.
 */
class InMemoryQueueRepository {
  constructor(initialState) {
    this.state = initialState || QueueState.createEmpty();
  }

  /**
   * Возвращает текущее состояние очереди.
   * @returns {Promise<QueueState>}
   */
  async get() {
    return this.state;
  }

  /**
   * Сохраняет новое состояние очереди.
   * @param {QueueState} state
   * @returns {Promise<void>}
   */
  async save(state) {
    this.state = state;
  }
}

export { InMemoryQueueRepository };

