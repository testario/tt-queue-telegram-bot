const MAX_QUEUE_WRITE_ATTEMPTS = 3;

/** Ошибка исчерпания попыток CAS-записи состояния очереди. */
class QueueStateConflictError extends Error {
  /**
   * @param {string} operation
   */
  constructor(operation) {
    super(`Queue state update conflicted: ${operation}`);
    this.name = "QueueStateConflictError";
  }
}

/**
 * Выполняет read-modify-write очереди через optimistic CAS.
 * @param {Object} deps
 * @param {import("#application/types.js").QueueRepository} deps.repository
 * @param {(state: import("#application/types.js").QueueState) => Object|Promise<Object>} deps.mutate
 * @param {import("#application/types.js").Logger} deps.logger
 * @param {string} deps.operation
 * @returns {Promise<Object>}
 */
async function updateQueueState({ repository, mutate, logger, operation }) {
  for (let attempt = 1; attempt <= MAX_QUEUE_WRITE_ATTEMPTS; attempt += 1) {
    const { state, revision } = await repository.getVersioned();
    const mutation = await mutate(state);
    if (mutation.save === false) return mutation;
    const saved = await repository.saveIfRevision(revision, mutation.state);

    if (saved) return mutation;

    logger.warn("Конфликт версии состояния очереди, повтор операции", {
      operation,
      attempt,
      maxAttempts: MAX_QUEUE_WRITE_ATTEMPTS,
    });
  }

  const error = new QueueStateConflictError(operation);
  throw error;
}

export { MAX_QUEUE_WRITE_ATTEMPTS, QueueStateConflictError, updateQueueState };
