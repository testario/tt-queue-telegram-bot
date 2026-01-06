import { QueueService } from "#domain/services/QueueService.js";
import { QueueState } from "#domain/entities/QueueState.js";
import { Match } from "#domain/entities/Match.js";
import { DEFAULT_GAME_TIME, TIME_READY } from "#application/config/time.js";

const WORK_SCHEDULE_TEST = {
  workStart: { hour: 10, minute: 0 },
  lunchStart: { hour: 13, minute: 0 },
  lunchDurationMinutes: 60,
  workEnd: { hour: 18, minute: 0 },
};

describe("QueueService", () => {
  let service;
  let now;

  beforeEach(() => {
    service = new QueueService({
      readyMs: TIME_READY,
      gameMs: DEFAULT_GAME_TIME,
      workSchedule: WORK_SCHEDULE_TEST,
    });
    now = new Date();
  });

  test("does not register search twice", () => {
    const base = QueueState.createEmpty();
    const { state: s1 } = service.registerSearch(base, "@p1");

    const again = service.registerSearch(s1, "@p1");

    expect(again.status).toBe("already_searching");
    expect(again.state.searching).toEqual(["@p1"]);
  });

  test("rejects search when already played", () => {
    const state = new QueueState({ played: ["@p1"] });

    const result = service.registerSearch(state, "@p1");

    expect(result.status).toBe("played");
  });

  test("rejects match with same player", () => {
    const state = QueueState.createEmpty();
    service.registerSearch(state, "@p1");

    const result = service.scheduleMatch(state, "@p1", "@p1", now);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("same_player");
  });

  test("rejects match when player not searching", () => {
    const state = QueueState.createEmpty();

    const result = service.scheduleMatch(state, "@p1", "@p2", now);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("player1_not_searching");
  });

  test("rejects match when player already in queue", () => {
    const base = QueueState.createEmpty();
    const { state: s1 } = service.registerSearch(base, "@p1");
    const { state: withMatch } = service.scheduleMatch(s1, "@p1", "@p2", now);

    const result = service.scheduleMatch(withMatch, "@p1", "@p3", now);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("already_in_queue");
  });

  test("registers player search when free", () => {
    const state = QueueState.createEmpty();
    const { state: nextState, status } = service.registerSearch(state, "@p1");

    expect(status).toBe("added");
    expect(nextState.searching.includes("@p1")).toBe(true);
  });

  test("schedules first match as playing", () => {
    const state = QueueState.createEmpty();
    const { state: withSearch } = service.registerSearch(state, "@p1");
    const result = service.scheduleMatch(withSearch, "@p1", "@p2", now);

    expect(result.ok).toBe(true);
    expect(result.match.status).toBe(Match.statuses.playing);
    expect(result.state.queue).toHaveLength(1);
  });

  test("moves to next match on finish", () => {
    // Используем фиксированное время внутри рабочего дня, чтобы не зависеть от локального времени запуска тестов
    const matchTime = new Date(2024, 0, 1, 11, 0, 0, 0);
    const base = QueueState.createEmpty();
    const { state: s1 } = service.registerSearch(base, "@p1", matchTime);
    const { state: s2 } = service.scheduleMatch(s1, "@p1", "@p2", matchTime);
    const { state: s3 } = service.registerSearch(s2, "@p3", matchTime);
    const { state: s4 } = service.scheduleMatch(s3, "@p3", "@p4", matchTime);

    const { state: afterFinish, endedMatch, nextMatch } = service.finishCurrent(
      s4,
      matchTime
    );

    expect(endedMatch.player1).toBe("@p1");
    expect(afterFinish.played).toEqual(expect.arrayContaining(["@p1", "@p2"]));
    expect(nextMatch.status).toBe(Match.statuses.playing);
    expect(afterFinish.queue[0].player1).toBe("@p3");
  });

  test("cancels current match and promotes next", () => {
    const base = QueueState.createEmpty();
    const { state: s1 } = service.registerSearch(base, "@p1");
    const { state: s2 } = service.scheduleMatch(s1, "@p1", "@p2", now);
    const { state: s3 } = service.registerSearch(s2, "@p3");
    const { state: s4 } = service.scheduleMatch(s3, "@p3", "@p4", now);

    const result = service.cancelMatch(s4, "@p1", now);

    expect(result.status).toBe("removed_current");
    expect(result.nextMatch.player1).toBe("@p3");
    expect(result.state.queue[0].status).toBe(Match.statuses.playing);
  });

  test("returns not_found when canceling missing match", () => {
    const state = QueueState.createEmpty();

    const result = service.cancelMatch(state, "@ghost", now);

    expect(result.status).toBe("not_found");
  });

  test("recalculates waiting matches when removing current", () => {
    const baseNow = new Date(0);
    const base = QueueState.createEmpty();
    const { state: s1 } = service.registerSearch(base, "@p1");
    const { state: s2 } = service.scheduleMatch(s1, "@p1", "@p2", baseNow);
    const { state: s3 } = service.registerSearch(s2, "@p3");
    const { state: s4 } = service.scheduleMatch(s3, "@p3", "@p4", baseNow);

    const cancelTime = new Date(baseNow.getTime() + 15000);
    const result = service.cancelMatch(s4, "@p1", cancelTime);

    expect(result.status).toBe("removed_current");
    expect(result.remains).toBe(DEFAULT_GAME_TIME - (cancelTime - s4.queue[0].startDate));
    expect(result.state.queue[0].status).toBe(Match.statuses.playing);
    expect(result.state.queue[0].startDate.getTime()).toBe(
      cancelTime.getTime() + TIME_READY
    );
  });

  test("recalculates waiting queue after removing middle match", () => {
    const base = QueueState.createEmpty();
    const { state: s1 } = service.registerSearch(base, "@p1");
    const { state: s2 } = service.scheduleMatch(s1, "@p1", "@p2", now);
    const { state: s3 } = service.registerSearch(s2, "@p3");
    const { state: s4 } = service.scheduleMatch(s3, "@p3", "@p4", now);
    const { state: s5 } = service.registerSearch(s4, "@p5");
    const { state: s6 } = service.scheduleMatch(s5, "@p5", "@p6", now);

    const result = service.cancelMatch(s6, "@p3", now);

    expect(result.status).toBe("removed_waiting");
    expect(result.state.queue).toHaveLength(2);
    const [current, waiting] = result.state.queue;
    expect(waiting.startDate.getTime()).toBe(
      current.endDate.getTime() + TIME_READY
    );
  });

  test("очищает список сыгравших при наступлении обеда", () => {
    const lunchTime = new Date(2024, 0, 1, 13, 15, 0, 0);
    const state = new QueueState({
      played: ["@p1", "@p2"],
      lastPlayedResetAt: new Date(2024, 0, 1, 9, 0, 0, 0),
    });

    const { state: result, status } = service.registerSearch(state, "@p3", lunchTime);

    expect(status).toBe("added");
    expect(result.played).toEqual([]);
    expect(result.lastPlayedResetAt).not.toBeNull();
  });

  test("не добавляет сыгравших во время обеда", () => {
    const beforeLunch = new Date(2024, 0, 1, 12, 50, 0, 0);
    const lunchTime = new Date(2024, 0, 1, 13, 5, 0, 0);
    const { state: s1 } = service.registerSearch(
      QueueState.createEmpty(),
      "@p1",
      beforeLunch
    );
    const { state: s2 } = service.scheduleMatch(s1, "@p1", "@p2", beforeLunch);

    const { state: afterFinish } = service.finishCurrent(s2, lunchTime);

    expect(afterFinish.played).toEqual([]);
  });

  test("очищает и не добавляет сыгравших после окончания рабочего дня", () => {
    const beforeEnd = new Date(2024, 0, 1, 17, 0, 0, 0);
    const afterEnd = new Date(2024, 0, 1, 18, 5, 0, 0);
    const { state: s1 } = service.registerSearch(
      QueueState.createEmpty(),
      "@p1",
      beforeEnd
    );
    const { state: s2 } = service.scheduleMatch(s1, "@p1", "@p2", beforeEnd);

    const { state: afterFinish } = service.finishCurrent(s2, afterEnd);

    expect(afterFinish.played).toEqual([]);
    expect(afterFinish.lastPlayedResetAt).not.toBeNull();
  });

  test("cancel search returns not_found when player absent", () => {
    const state = QueueState.createEmpty();

    const result = service.cancelSearch(state, "@nobody");

    expect(result.status).toBe("not_found");
  });
});

