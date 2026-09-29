import {
  canCreateTournamentMatch,
  getTournamentPlayers,
  normalizeTournamentPlayer,
} from "#application/config/tournament.js";

describe("Tournament config", () => {
  test("читает ники без учета регистра, @ и разделителя", () => {
    expect([...getTournamentPlayers("Alice, @BOB carol")]).toEqual(["@alice", "@bob", "@carol"]);
  });

  test("возвращает пустой список, если переменная не задана", () => {
    expect(getTournamentPlayers("")).toEqual(new Set());
  });

  test("нормализует ник приглашенного игрока", () => {
    expect(normalizeTournamentPlayer(" @Opponent ")).toBe("@opponent");
    expect(normalizeTournamentPlayer("Opponent")).toBe("@opponent");
  });

  test("разрешает матч только между участниками турнира", () => {
    const tournamentPlayers = getTournamentPlayers("@player1, player2");

    expect(canCreateTournamentMatch(tournamentPlayers, "@Player1", "@PLAYER2")).toBe(true);
    expect(canCreateTournamentMatch(tournamentPlayers, "@player1", "@player3")).toBe(false);
    expect(canCreateTournamentMatch(tournamentPlayers, "@player3", "@player2")).toBe(false);
    expect(canCreateTournamentMatch(tournamentPlayers, "", "@player2")).toBe(false);
  });
});
