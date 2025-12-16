class NodeTimer {
  constructor() {
    this.handles = new Map();
  }

  schedule(id, delayMs, callback) {
    this.cancel(id);
    const handle = setTimeout(() => {
      this.handles.delete(id);
      callback();
    }, delayMs);
    this.handles.set(id, handle);
  }

  cancel(id) {
    const handle = this.handles.get(id);
    if (handle) {
      clearTimeout(handle);
      this.handles.delete(id);
    }
  }

  cancelAll() {
    Array.from(this.handles.keys()).forEach((key) => this.cancel(key));
  }
}

export { NodeTimer };

