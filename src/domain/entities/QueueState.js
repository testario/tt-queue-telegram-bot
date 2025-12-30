/**
 * Состояние очереди и истории матчей.
 */
class QueueState {
  /**
   * @param {Object} [params] Параметры состояния.
   * @param {import("./Match.js").Match[]} [params.queue] Очередь матчей.
   * @param {string[]} [params.played] Игроки, уже сыгравшие сегодня.
   * @param {string[]} [params.searching] Игроки в поиске.
   * @param {Date|null} [params.lastPlayedResetAt] Время последнего сброса списка сыгравших.
   */
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

  /**
   * Создает пустое состояние очереди.
   * @returns {QueueState}
   */
  static createEmpty() {
    return new QueueState();
  }

  /**
   * Восстанавливает состояние из сериализованного представления.
   * @param {Object} [raw] Сырые данные состояния.
   * @param {Object[]} [raw.queue] Очередь матчей.
   * @param {string[]} [raw.played] Уже сыгравшие игроки.
   * @param {string[]} [raw.searching] Игроки в поиске.
   * @param {Date|string|null} [raw.lastPlayedResetAt] Время сброса списка сыгравших.
   * @returns {QueueState}
   */
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

  /**
   * Создает глубокую копию состояния.
   * @returns {QueueState}
   */
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

  /**
   * Проверяет присутствие игрока в любом списке.
   * @param {string} player Игрок.
   * @returns {boolean}
   */
  hasPlayer(player) {
    return (
      this.isSearching(player) || this.isQueued(player) || this.isPlayed(player)
    );
  }

  /**
   * Проверяет, находится ли игрок в поиске.
   * @param {string} player Игрок.
   * @returns {boolean}
   */
  isSearching(player) {
    return this.searching.includes(player);
  }

  /**
   * Проверяет, стоит ли игрок в очереди матчей.
   * @param {string} player Игрок.
   * @returns {boolean}
   */
  isQueued(player) {
    return (
      this.queue.findIndex(
        (match) => match.player1 === player || match.player2 === player
      ) > -1
    );
  }

  /**
   * Проверяет, сыграл ли игрок сегодня.
   * @param {string} player Игрок.
   * @returns {boolean}
   */
  isPlayed(player) {
    return this.played.includes(player);
  }

  /**
   * Добавляет игрока в список поиска.
   * @param {string} player Игрок.
   */
  addSearching(player) {
    if (!this.searching.includes(player)) {
      this.searching.push(player);
    }
  }

  /**
   * Удаляет игрока из списка поиска.
   * @param {string} player Игрок.
   */
  removeSearching(player) {
    const index = this.searching.indexOf(player);
    if (index > -1) {
      this.searching.splice(index, 1);
    }
  }

  /**
   * Добавляет матч в очередь.
   * @param {import("./Match.js").Match} match Матч для добавления.
   */
  enqueue(match) {
    this.queue.push(match);
  }

  /**
   * Извлекает и возвращает первый матч в очереди.
   * @returns {import("./Match.js").Match|undefined}
   */
  shiftQueue() {
    return this.queue.shift();
  }

  /**
   * Удаляет матч по любому из игроков.
   * @param {string} player Игрок, участвующий в матче.
   * @returns {{match: import("./Match.js").Match|null, index: number}}
   */
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

