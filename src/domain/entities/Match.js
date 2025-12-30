/**
 * Данные о запланированном матче.
 */
class Match {
  /**
   * @param {Object} params Параметры матча.
   * @param {string} params.player1 Первый игрок.
   * @param {string} params.player2 Второй игрок.
   * @param {Date} params.startDate Время начала.
   * @param {Date} params.endDate Время окончания.
   * @param {"playing"|"waiting"} [params.status] Статус матча.
   */
  constructor({ player1, player2, startDate, endDate, status }) {
    this.player1 = player1;
    this.player2 = player2;
    this.startDate = startDate;
    this.endDate = endDate;
    this.status = status || Match.statuses.waiting;
  }

  /**
   * Создает экземпляр матча.
   * @param {Object} params Параметры матча.
   * @param {string} params.player1 Первый игрок.
   * @param {string} params.player2 Второй игрок.
   * @param {Date} params.startDate Время начала.
   * @param {Date} params.endDate Время окончания.
   * @param {"playing"|"waiting"} [params.status] Статус матча.
   * @returns {Match}
   */
  static create({ player1, player2, startDate, endDate, status }) {
    return new Match({ player1, player2, startDate, endDate, status });
  }
}

/**
 * Возможные статусы матча.
 * @readonly
 * @enum {string}
 */
Match.statuses = {
  playing: "playing",
  waiting: "waiting",
};

export { Match };

