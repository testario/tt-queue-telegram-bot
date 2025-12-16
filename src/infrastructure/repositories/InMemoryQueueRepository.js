import { QueueState } from "#domain/entities/QueueState.js";

class InMemoryQueueRepository {
  constructor(initialState) {
    this.state = initialState || QueueState.createEmpty();
  }

  async get() {
    return this.state;
  }

  async save(state) {
    this.state = state;
  }
}

export { InMemoryQueueRepository };

