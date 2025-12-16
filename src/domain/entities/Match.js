class Match {
  constructor({ player1, player2, startDate, endDate, status }) {
    this.player1 = player1;
    this.player2 = player2;
    this.startDate = startDate;
    this.endDate = endDate;
    this.status = status || Match.statuses.waiting;
  }

  static create({ player1, player2, startDate, endDate, status }) {
    return new Match({ player1, player2, startDate, endDate, status });
  }
}

Match.statuses = {
  playing: "playing",
  waiting: "waiting",
};

export { Match };

