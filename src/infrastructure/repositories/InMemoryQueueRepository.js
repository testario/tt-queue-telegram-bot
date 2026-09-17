import { QueueState } from "#domain/entities/QueueState.js";

/**
 * Хранит состояние очереди в памяти процесса.
 */
/**
 * @implements {import("#application/types.js").QueueRepository}
 */
class InMemoryQueueRepository {
  constructor(initialState) {
    this.state = QueueState.from(initialState || QueueState.createEmpty()).clone()
    this.revision = 0
  }

  /**
   * Возвращает текущее состояние очереди.
   * @returns {Promise<QueueState>}
   */
  async get() {
    return this.state.clone()
  }

  async getVersioned() {
    return { state: this.state.clone(), revision: this.revision }
  }

  /**
   * Сохраняет новое состояние очереди.
   * @param {QueueState} state
   * @returns {Promise<void>}
   */
  async save(state) {
    this.state = QueueState.from(state).clone()
    this.revision += 1
  }

  async saveIfRevision(expectedRevision, state) {
    if (Number(expectedRevision) !== this.revision) return false
    this.state = QueueState.from(state).clone()
    this.revision += 1
    return true
  }
}

export { InMemoryQueueRepository };
