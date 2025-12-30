/**
 * Планировщик таймеров поверх `setTimeout`.
 */
/**
 * @implements {import("#application/types.js").Timer}
 */
class NodeTimer {
  constructor() {
    this.handles = new Map();
  }

  /**
   * Планирует задачу с указанной задержкой.
   * @param {string|number} id
   * @param {number} delayMs
   * @param {Function} callback
   */
  schedule(id, delayMs, callback) {
    this.cancel(id);
    const handle = setTimeout(() => {
      this.handles.delete(id);
      callback();
    }, delayMs);
    this.handles.set(id, handle);
  }

  /**
   * Отменяет задачу по идентификатору.
   * @param {string|number} id
   */
  cancel(id) {
    const handle = this.handles.get(id);
    if (handle) {
      clearTimeout(handle);
      this.handles.delete(id);
    }
  }

  /**
   * Отменяет все активные задачи.
   */
  cancelAll() {
    Array.from(this.handles.keys()).forEach((key) => this.cancel(key));
  }
}

export { NodeTimer };

