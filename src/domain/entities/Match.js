/**
 * Данные о запланированном матче.
 */
class Match {
  /**
   * @param {Object} params Параметры матча.
   * @param {string} params.id Идентификатор матча в очереди.
   * @param {string} params.player1 Первый игрок.
   * @param {string} params.player2 Второй игрок.
   * @param {Date|null} params.startDate Время начала. Может быть неизвестно до завершения предыдущего турнира.
   * @param {Date|null} params.endDate Время окончания. У турнирного матча отсутствует.
   * @param {"playing"|"waiting"} [params.status] Статус матча.
   * @param {Record<string, object>} [params.participantIdentities] Immutable participant identity tokens.
   * @param {Record<string, object>} [params.participantIdentities] Immutable participant identity tokens.
   * @param {"standard"|"tournament"} [params.type] Тип матча.
   */
  constructor({ id, player1, player2, startDate, endDate, status, participantIdentities = {}, type }) {
    this.id = id;
    this.player1 = player1;
    this.player2 = player2;
    this.startDate = startDate;
    this.endDate = endDate;
    this.status = status || Match.statuses.waiting;
    this.participantIdentities = Object.fromEntries(
      Object.entries(participantIdentities || {}).map(([username, identity]) => [username, { ...identity }])
    );
    this.type = type || Match.types.standard;
  }

  /**
   * Создает экземпляр матча.
   * @param {Object} params Параметры матча.
   * @param {string} params.id Идентификатор матча в очереди.
   * @param {string} params.player1 Первый игрок.
   * @param {string} params.player2 Второй игрок.
   * @param {Date|null} params.startDate Время начала. Может быть неизвестно до завершения предыдущего турнира.
   * @param {Date|null} params.endDate Время окончания. У турнирного матча отсутствует.
   * @param {"playing"|"waiting"} [params.status] Статус матча.
   * @param {Record<string, object>} [params.participantIdentities] Immutable participant identity tokens.
   * @param {Record<string, object>} [params.participantIdentities] Immutable participant identity tokens.
   * @param {"standard"|"tournament"} [params.type] Тип матча.
   * @returns {Match}
   */
  static create({ id, player1, player2, startDate, endDate, status, participantIdentities, type }) {
    return new Match({ id, player1, player2, startDate, endDate, status, participantIdentities, type });
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

/**
 * Возможные типы матча.
 * @readonly
 * @enum {string}
 */
Match.types = {
  standard: "standard",
  tournament: "tournament",
};

export { Match };
