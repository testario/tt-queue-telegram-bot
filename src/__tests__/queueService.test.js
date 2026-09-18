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

  const token = (username) => ({ username, userId: `test:${username}`, generation: 1 });
  const ensureOwner = (state, ...players) => {
    for (const player of players) {
      state.ownership[player] = { userId: token(player).userId, generation: 1, status: "active" };
    }
    return state;
  };
  const registerSearch = (state, player, time = now) =>
    service.registerSearch(ensureOwner(state, player), player, time, { identityToken: token(player) });
  const scheduleMatch = (state, player1, player2, time, options = {}) =>
    service.scheduleMatch(ensureOwner(state, player1, player2), player1, player2, time, {
      ...options,
      participantIdentities: options.participantIdentities || {
        [player1]: token(player1),
        [player2]: token(player2),
      },
    });
  const cancelMatch = (state, player, time) =>
    service.cancelMatch(ensureOwner(state, player), player, time, { identityToken: token(player) });
  const cancelSearch = (state, player, time = now) =>
    service.cancelSearch(ensureOwner(state, player), player, time, { identityToken: token(player) });

  test("does not register search twice", () => {
    const base = QueueState.createEmpty();
    const { state: s1 } = registerSearch(base, "@p1");

    const again = registerSearch(s1, "@p1");

    expect(again.status).toBe("already_searching");
    expect(again.state.searching).toEqual(["@p1"]);
  });

  test("rejects search when already played", () => {
    const state = new QueueState({ played: ["@p1"] });

    const result = registerSearch(state, "@p1");

    expect(result.status).toBe("played");
  });

  test("keeps the renamed old owner busy while allowing a new owner to reuse the username", () => {
    const state = new QueueState({
      queue: [Match.create({
        player1: "@old",
        player2: "@opponent",
        startDate: now,
        endDate: new Date(now.getTime() + 1_000),
        participantIdentities: {
          "@old": token("@old"),
          "@opponent": token("@opponent"),
        },
      })],
      ownership: {
        "@new": { userId: "test:@old", generation: 2, status: "active" },
        "@old": { userId: "new-owner", generation: 3, status: "active" },
        "@third": { userId: "third-owner", generation: 4, status: "active" },
      },
    });

    expect(service.registerSearch(state, "@new", now, {
      identityToken: { username: "@new", userId: "test:@old", generation: 2 },
    }).status).toBe("in_queue");

    const reused = service.registerSearch(state, "@old", now, {
      identityToken: { username: "@old", userId: "new-owner", generation: 3 },
    });
    expect(reused.status).toBe("added");
    expect(service.scheduleMatch(reused.state, "@old", "@third", now, {
      participantIdentities: {
        "@old": { username: "@old", userId: "new-owner", generation: 3 },
        "@third": { username: "@third", userId: "third-owner", generation: 4 },
      },
    }).ok).toBe(true);
  });

  test("rejects match with same player", () => {
    const state = QueueState.createEmpty();
    registerSearch(state, "@p1");

    const result = scheduleMatch(state, "@p1", "@p1", now);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("same_player");
  });

  test("rejects match when player not searching", () => {
    const state = QueueState.createEmpty();

    const result = scheduleMatch(state, "@p1", "@p2", now);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("player1_not_searching");
  });

  test("rejects match when player already in queue", () => {
    const base = QueueState.createEmpty();
    const { state: s1 } = registerSearch(base, "@p1");
    const { state: withMatch } = scheduleMatch(s1, "@p1", "@p2", now);

    const result = scheduleMatch(withMatch, "@p1", "@p3", now);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("already_in_queue");
  });

  test("cleans stale search before rejecting another match condition", () => {
    const state = new QueueState({
      searching: ["@old"],
      searchingUserIds: { "@old": 42 },
      searchingIdentities: { "@old": { username: "@old", userId: 42, generation: 1 } },
      ownership: {
        "@old": { userId: 99, generation: 2, status: "active" },
        "@p2": { userId: "test:@p2", generation: 1, status: "active" },
      },
      queue: [
        Match.create({
          player1: "@p2",
          player2: "@queued",
          startDate: now,
          endDate: new Date(now.getTime() + 1_000),
        }),
      ],
    });

    const result = scheduleMatch(state, "@old", "@p2", now, {
      participantIdentities: {
        "@old": { username: "@old", userId: 99, generation: 1 },
        "@p2": token("@p2"),
      },
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("player1_identity_mismatch");
    expect(result.state.searching).toEqual([]);
    expect(result.state.searchingUserIds).toEqual({});
  });

  test("registers player search when free", () => {
    const state = QueueState.createEmpty();
    const { state: nextState, status } = registerSearch(state, "@p1");

    expect(status).toBe("added");
    expect(nextState.searching.includes("@p1")).toBe(true);
  });

  test("schedules first match as playing", () => {
    const state = QueueState.createEmpty();
    const { state: withSearch } = registerSearch(state, "@p1");
    const result = scheduleMatch(withSearch, "@p1", "@p2", now);

    expect(result.ok).toBe(true);
    expect(result.match.status).toBe(Match.statuses.playing);
    expect(result.state.queue).toHaveLength(1);
  });

  test("moves to next match on finish", () => {
    // Используем фиксированное время внутри рабочего дня, чтобы не зависеть от локального времени запуска тестов
    const matchTime = new Date(2024, 0, 1, 11, 0, 0, 0);
    const base = QueueState.createEmpty();
    const { state: s1 } = registerSearch(base, "@p1", matchTime);
    const { state: s2 } = scheduleMatch(s1, "@p1", "@p2", matchTime);
    const { state: s3 } = registerSearch(s2, "@p3", matchTime);
    const { state: s4 } = scheduleMatch(s3, "@p3", "@p4", matchTime);

    const { state: afterFinish, endedMatch, nextMatch } = service.finishCurrent(
      s4,
      matchTime
    );

    expect(endedMatch.player1).toBe("@p1");
    expect(afterFinish.played).toEqual(expect.arrayContaining(["@p1", "@p2"]));
    expect(nextMatch.status).toBe(Match.statuses.playing);
    expect(afterFinish.queue[0].player1).toBe("@p3");
  });

  test("keeps the next match waiting when durable pause requests a hold", () => {
    const matchTime = new Date(2024, 0, 1, 11, 0, 0, 0);
    const first = Match.create({
      player1: "@p1",
      player2: "@p2",
      startDate: matchTime,
      endDate: new Date(matchTime.getTime() + DEFAULT_GAME_TIME),
      status: Match.statuses.playing,
    });
    const next = Match.create({
      player1: "@p3",
      player2: "@p4",
      startDate: new Date(matchTime.getTime() + DEFAULT_GAME_TIME + TIME_READY),
      endDate: new Date(matchTime.getTime() + DEFAULT_GAME_TIME * 2 + TIME_READY),
      status: Match.statuses.waiting,
    });
    const state = new QueueState({ queue: [first, next], holdNextMatch: true });

    const result = service.finishCurrent(state, first.endDate);

    expect(result.nextMatch).toBeNull();
    expect(result.heldNextMatch).toEqual(next);
    expect(result.state.queue[0].status).toBe(Match.statuses.waiting);
    expect(result.state.holdNextMatch).toBe(false);
  });

  test("cancels current match and promotes next", () => {
    const base = QueueState.createEmpty();
    const { state: s1 } = registerSearch(base, "@p1");
    const { state: s2 } = scheduleMatch(s1, "@p1", "@p2", now);
    const { state: s3 } = registerSearch(s2, "@p3");
    const { state: s4 } = scheduleMatch(s3, "@p3", "@p4", now);

    const result = cancelMatch(s4, "@p1", now);

    expect(result.status).toBe("removed_current");
    expect(result.nextMatch.player1).toBe("@p3");
    expect(result.state.queue[0].status).toBe(Match.statuses.playing);
  });

  test("consumes durable hold when canceling current match and keeps next waiting", () => {
    const current = Match.create({
      player1: "@p1",
      player2: "@p2",
      startDate: now,
      endDate: new Date(now.getTime() + DEFAULT_GAME_TIME),
      status: Match.statuses.playing,
      participantIdentities: { "@p1": token("@p1"), "@p2": token("@p2") },
    });
    const next = Match.create({
      player1: "@p3",
      player2: "@p4",
      startDate: new Date(current.endDate.getTime() + TIME_READY),
      endDate: new Date(current.endDate.getTime() + TIME_READY + DEFAULT_GAME_TIME),
      status: Match.statuses.waiting,
      participantIdentities: { "@p3": token("@p3"), "@p4": token("@p4") },
    });
    const state = ensureOwner(new QueueState({ queue: [current, next], holdNextMatch: true }), "@p1", "@p2", "@p3", "@p4");

    const result = cancelMatch(state, "@p1", now);

    expect(result.status).toBe("removed_current");
    expect(result.nextMatch).toBeNull();
    expect(result.heldNextMatch).toEqual(next);
    expect(result.state.holdNextMatch).toBe(false);
    expect(result.state.queue[0].status).toBe(Match.statuses.waiting);
  });

  test("returns not_found when canceling missing match", () => {
    const state = QueueState.createEmpty();

    const result = cancelMatch(state, "@ghost", now);

    expect(result.status).toBe("not_found");
  });

  test("recalculates waiting matches when removing current", () => {
    const baseNow = new Date(0);
    const base = QueueState.createEmpty();
    const { state: s1 } = registerSearch(base, "@p1");
    const { state: s2 } = scheduleMatch(s1, "@p1", "@p2", baseNow);
    const { state: s3 } = registerSearch(s2, "@p3");
    const { state: s4 } = scheduleMatch(s3, "@p3", "@p4", baseNow);

    const cancelTime = new Date(baseNow.getTime() + 15000);
    const result = cancelMatch(s4, "@p1", cancelTime);

    expect(result.status).toBe("removed_current");
    expect(result.remains).toBe(DEFAULT_GAME_TIME - (cancelTime - s4.queue[0].startDate));
    expect(result.state.queue[0].status).toBe(Match.statuses.playing);
    expect(result.state.queue[0].startDate.getTime()).toBe(
      cancelTime.getTime() + TIME_READY
    );
  });

  test("recalculates waiting queue after removing middle match", () => {
    const base = QueueState.createEmpty();
    const { state: s1 } = registerSearch(base, "@p1");
    const { state: s2 } = scheduleMatch(s1, "@p1", "@p2", now);
    const { state: s3 } = registerSearch(s2, "@p3");
    const { state: s4 } = scheduleMatch(s3, "@p3", "@p4", now);
    const { state: s5 } = registerSearch(s4, "@p5");
    const { state: s6 } = scheduleMatch(s5, "@p5", "@p6", now);

    const result = cancelMatch(s6, "@p3", now);

    expect(result.status).toBe("removed_waiting");
    expect(result.state.queue).toHaveLength(2);
    const [current, waiting] = result.state.queue;
    expect(waiting.startDate.getTime()).toBe(
      current.endDate.getTime() + TIME_READY
    );
  });

  test("cancels a renamed participant by immutable userId only", () => {
    const currentToken = { username: "@new", userId: 1, generation: 3 };
    const oldOwnerToken = { username: "@old", userId: 2, generation: 4 };
    const renamedMatch = Match.create({
      player1: "@old",
      player2: "@opponent",
      startDate: now,
      endDate: new Date(now.getTime() + DEFAULT_GAME_TIME),
      participantIdentities: {
        "@old": { username: "@old", userId: 1, generation: 1 },
        "@opponent": token("@opponent"),
      },
    });
    const differentOwnerMatch = Match.create({
      player1: "@old",
      player2: "@other",
      startDate: new Date(now.getTime() + DEFAULT_GAME_TIME + TIME_READY),
      endDate: new Date(now.getTime() + 2 * DEFAULT_GAME_TIME),
      participantIdentities: {
        "@old": oldOwnerToken,
        "@other": token("@other"),
      },
    });
    const state = new QueueState({
      queue: [renamedMatch, differentOwnerMatch],
      ownership: {
        "@new": { userId: 1, generation: 3, status: "active" },
        "@old": { userId: 2, generation: 4, status: "active" },
      },
    });

    const result = service.cancelMatch(state, "@new", now, { identityToken: currentToken });

    expect(result.status).toBe("removed_current");
    expect(result.removedMatch).toMatchObject(renamedMatch);
    expect(result.state.queue).toHaveLength(1);
    expect(result.state.queue[0]).toMatchObject({ player1: "@old", player2: "@other" });
    expect(result.state.queue[0].participantIdentities["@old"]).toEqual(oldOwnerToken);
  });

  test("очищает список сыгравших при наступлении обеда", () => {
    const lunchTime = new Date(2024, 0, 1, 13, 15, 0, 0);
    const state = new QueueState({
      played: ["@p1", "@p2"],
      lastPlayedResetAt: new Date(2024, 0, 1, 9, 0, 0, 0),
    });

    const { state: result, status } = registerSearch(state, "@p3", lunchTime);

    expect(status).toBe("added");
    expect(result.played).toEqual([]);
    expect(result.lastPlayedResetAt).not.toBeNull();
  });

  test("clears immutable played identities together with played usernames", () => {
    const lunchTime = new Date(2024, 0, 1, 13, 15, 0, 0);
    const state = new QueueState({
      played: ["@p1"],
      playedIdentities: [{ username: "@p1", userId: 1, generation: 1 }],
      lastPlayedResetAt: new Date(2024, 0, 1, 9, 0, 0, 0),
    });

    const { state: result } = registerSearch(state, "@p3", lunchTime);

    expect(result.played).toEqual([]);
    expect(result.playedIdentities).toEqual([]);
  });

  test("не добавляет сыгравших во время обеда", () => {
    const beforeLunch = new Date(2024, 0, 1, 12, 50, 0, 0);
    const lunchTime = new Date(2024, 0, 1, 13, 5, 0, 0);
    const { state: s1 } = registerSearch(
      QueueState.createEmpty(),
      "@p1",
      beforeLunch
    );
    const { state: s2 } = scheduleMatch(s1, "@p1", "@p2", beforeLunch);

    const { state: afterFinish } = service.finishCurrent(s2, lunchTime);

    expect(afterFinish.played).toEqual([]);
  });

  test("очищает и не добавляет сыгравших после окончания рабочего дня", () => {
    const beforeEnd = new Date(2024, 0, 1, 17, 0, 0, 0);
    const afterEnd = new Date(2024, 0, 1, 18, 5, 0, 0);
    const { state: s1 } = registerSearch(
      QueueState.createEmpty(),
      "@p1",
      beforeEnd
    );
    const { state: s2 } = scheduleMatch(s1, "@p1", "@p2", beforeEnd);

    const { state: afterFinish } = service.finishCurrent(s2, afterEnd);

    expect(afterFinish.played).toEqual([]);
    expect(afterFinish.lastPlayedResetAt).not.toBeNull();
  });

  test("cancel search returns not_found when player absent", () => {
    const state = QueueState.createEmpty();

    const result = cancelSearch(state, "@nobody");

    expect(result.status).toBe("not_found");
  });
});
