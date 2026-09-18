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
   * @param {Record<string, object>} [params.participantIdentities] Immutable participant identity tokens.
   */
  constructor({ player1, player2, startDate, endDate, status, participantIdentities = {} }) {
    this.player1 = player1;
    this.player2 = player2;
    this.startDate = startDate;
    this.endDate = endDate;
    this.status = status || Match.statuses.waiting;
    this.participantIdentities = Object.fromEntries(
      Object.entries(participantIdentities || {}).map(([username, identity]) => [username, { ...identity }])
    );
  }

  /**
   * Создает экземпляр матча.
   * @param {Object} params Параметры матча.
   * @param {string} params.player1 Первый игрок.
   * @param {string} params.player2 Второй игрок.
   * @param {Date} params.startDate Время начала.
   * @param {Date} params.endDate Время окончания.
   * @param {"playing"|"waiting"} [params.status] Статус матча.
   * @param {Record<string, object>} [params.participantIdentities] Immutable participant identity tokens.
   * @returns {Match}
   */
  static create({ player1, player2, startDate, endDate, status, participantIdentities }) {
    return new Match({ player1, player2, startDate, endDate, status, participantIdentities });
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
