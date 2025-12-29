class QueueState {
  constructor({
    queue = [],
    played = [],
    searching = [],
    lastPlayedResetAt = null,
  } = {}) {
    this.queue = queue;
    this.played = played;
    this.searching = searching;
    this.lastPlayedResetAt = lastPlayedResetAt
      ? new Date(lastPlayedResetAt)
      : null;
  }

  static createEmpty() {
    return new QueueState();
  }

  static from(raw) {
    if (!raw) return QueueState.createEmpty();
    const queue = (raw.queue || []).map((item) => ({
      ...item,
      startDate: new Date(item.startDate),
      endDate: new Date(item.endDate),
    }));
    return new QueueState({
      queue,
      played: raw.played || [],
      searching: raw.searching || [],
      lastPlayedResetAt: raw.lastPlayedResetAt
        ? new Date(raw.lastPlayedResetAt)
        : null,
    });
  }

  clone() {
    return QueueState.from({
      queue: this.queue.map((item) => ({
        ...item,
        startDate: item.startDate,
        endDate: item.endDate,
      })),
      played: [...this.played],
      searching: [...this.searching],
      lastPlayedResetAt: this.lastPlayedResetAt
        ? new Date(this.lastPlayedResetAt)
        : null,
    });
  }

  hasPlayer(player) {
    return (
      this.isSearching(player) || this.isQueued(player) || this.isPlayed(player)
    );
  }

  isSearching(player) {
    return this.searching.includes(player);
  }

  isQueued(player) {
    return (
      this.queue.findIndex(
        (match) => match.player1 === player || match.player2 === player
      ) > -1
    );
  }

  isPlayed(player) {
    return this.played.includes(player);
  }

  addSearching(player) {
    if (!this.searching.includes(player)) {
      this.searching.push(player);
    }
  }

  removeSearching(player) {
    const index = this.searching.indexOf(player);
    if (index > -1) {
      this.searching.splice(index, 1);
    }
  }

  enqueue(match) {
    this.queue.push(match);
  }

  shiftQueue() {
    return this.queue.shift();
  }

  removeMatchByPlayer(player) {
    const index = this.queue.findIndex(
      (match) => match.player1 === player || match.player2 === player
    );
    if (index === -1) return { match: null, index: -1 };
    const [match] = this.queue.splice(index, 1);
    return { match, index };
  }
}

export { QueueState };

