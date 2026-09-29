import { jest } from "@jest/globals";
import { FinishTournamentMatch } from "#application/features/tournament/FinishTournamentMatch.js";
import { Match } from "#domain";

describe("FinishTournamentMatch", () => {
  const match = {
    id: "match-1",
    player1: "@p1",
    player2: "@p2",
    type: Match.types.tournament,
    status: Match.statuses.playing,
  };

  test("завершает турнирный матч по нажатию его участника", async () => {
    const orchestrator = { handleMatchFinished: jest.fn() };
    const useCase = new FinishTournamentMatch({
      repository: { get: jest.fn().mockResolvedValue({ queue: [match] }) },
      orchestrator,
    });

    await expect(useCase.execute("@p1", "match-1")).resolves.toEqual({ ok: true });
    expect(orchestrator.handleMatchFinished).toHaveBeenCalledWith(match);
  });

  test("не дает завершить матч постороннему игроку", async () => {
    const useCase = new FinishTournamentMatch({
      repository: { get: jest.fn().mockResolvedValue({ queue: [match] }) },
      orchestrator: { handleMatchFinished: jest.fn() },
    });

    await expect(useCase.execute("@other", "match-1")).resolves.toEqual({
      ok: false,
      reason: "not_participant",
    });
  });

  test("не завершает следующий матч по кнопке из устаревшего сообщения", async () => {
    const orchestrator = { handleMatchFinished: jest.fn() };
    const useCase = new FinishTournamentMatch({
      repository: { get: jest.fn().mockResolvedValue({ queue: [match] }) },
      orchestrator,
    });

    await expect(useCase.execute("@p1", "match-0")).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(orchestrator.handleMatchFinished).not.toHaveBeenCalled();
  });

  test("не завершает один матч дважды при одновременных нажатиях", async () => {
    let resolveFinish;
    const orchestrator = {
      handleMatchFinished: jest.fn(
        () => new Promise((resolve) => {
          resolveFinish = resolve;
        })
      ),
    };
    const useCase = new FinishTournamentMatch({
      repository: { get: jest.fn().mockResolvedValue({ queue: [match] }) },
      orchestrator,
    });

    const firstFinish = useCase.execute("@p1", "match-1");
    await Promise.resolve();
    const secondFinish = useCase.execute("@p2", "match-1");

    await expect(secondFinish).resolves.toEqual({ ok: false, reason: "not_found" });
    expect(orchestrator.handleMatchFinished).toHaveBeenCalledTimes(1);

    resolveFinish();
    await expect(firstFinish).resolves.toEqual({ ok: true });
  });
});
