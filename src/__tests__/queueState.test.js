import { QueueState } from "#domain/entities/QueueState.js";
import { Match } from "#domain/entities/Match.js";

describe("QueueState", () => {
  test("clone делает глубокую копию состояния", () => {
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + 1000);
    const original = new QueueState({
      queue: [
        Match.create({
          player1: "@p1",
          player2: "@p2",
          startDate,
          endDate,
        }),
      ],
      played: ["@old"],
      searching: ["@s1"],
    });

    const cloned = original.clone();
    cloned.queue[0].player1 = "@changed";
    cloned.played.push("@new");
    cloned.searching.push("@s2");

    expect(original.queue[0].player1).toBe("@p1");
    expect(original.played).toEqual(["@old"]);
    expect(original.searching).toEqual(["@s1"]);
  });

  test("from восстанавливает даты и поля", () => {
    const raw = {
      queue: [
        {
          player1: "@p1",
          player2: "@p2",
          startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + 1000).toISOString(),
        },
      ],
      played: ["@p3"],
      searching: ["@p4"],
      holdNextMatch: true,
    };

    const state = QueueState.from(raw);

    expect(state.queue[0].startDate).toBeInstanceOf(Date);
    expect(state.queue[0].endDate).toBeInstanceOf(Date);
    expect(state.played).toEqual(["@p3"]);
    expect(state.searching).toEqual(["@p4"]);
    expect(state.holdNextMatch).toBe(true);
  });

  test("hasPlayer учитывает поиск, очередь и сыгравших", () => {
    const state = new QueueState({
      queue: [Match.create({ player1: "@q1", player2: "@q2", startDate: new Date(), endDate: new Date() })],
      played: ["@old"],
      searching: ["@look"],
    });

    expect(state.hasPlayer("@q1")).toBe(true);
    expect(state.hasPlayer("@q2")).toBe(true);
    expect(state.hasPlayer("@old")).toBe(true);
    expect(state.hasPlayer("@look")).toBe(true);
    expect(state.hasPlayer("@nobody")).toBe(false);
  });

  test("removeMatchByPlayer удаляет матч по игроку", () => {
    const match1 = Match.create({ player1: "@a", player2: "@b", startDate: new Date(), endDate: new Date() });
    const match2 = Match.create({ player1: "@c", player2: "@d", startDate: new Date(), endDate: new Date() });
    const state = new QueueState({ queue: [match1, match2] });

    const { match, index } = state.removeMatchByPlayer("@c");

    expect(index).toBe(1);
    expect(match.player1).toBe("@c");
    expect(state.queue).toEqual([match1]);
  });

  test("identity generations are monotonic and prevent ABA", () => {
    const state = QueueState.createEmpty();
    const first = state.reserveIdentity("@player", 1);
    expect(state.activateIdentity(first).ok).toBe(true);

    const second = state.reserveIdentity("@player", 2);
    expect(second.generation).toBe(first.generation + 1);
    expect(state.activateIdentity(second).ok).toBe(true);

    const third = state.reserveIdentity("@player", 1);
    expect(third.generation).toBe(second.generation + 1);
    expect(state.activateIdentity(first)).toEqual({ ok: false, reason: "identity_token_mismatch" });
    expect(state.identityEpoch).toBe(3);
    expect(state.identityTombstones["@player"].map(({ generation }) => generation)).toEqual([1, 2]);
  });

  test("same pending or active tuple is idempotent", () => {
    const state = QueueState.createEmpty();
    const pending = state.reserveIdentity("@player", 1);
    expect(state.reserveIdentity("@player", 1)).toEqual(pending);
    expect(state.identityEpoch).toBe(1);
    expect(state.activateIdentity(pending).ok).toBe(true);
    expect(state.activateIdentity(pending)).toEqual({ ok: true, idempotent: true, save: false });
  });

  test("unrelated claims activate independently", () => {
    const state = QueueState.createEmpty();
    const first = state.reserveIdentity("@first", 1);
    const second = state.reserveIdentity("@second", 2);

    expect(first.generation).toBe(1);
    expect(second.generation).toBe(2);
    expect(state.activateIdentity(first).ok).toBe(true);
    expect(state.activateIdentity(second).ok).toBe(true);
    expect(state.isActiveIdentity(first)).toBe(true);
    expect(state.isActiveIdentity(second)).toBe(true);
  });

  test("renaming after unrelated claims uses the next global generation", () => {
    const state = QueueState.createEmpty();
    const first = state.reserveIdentity("@old", 1);
    const unrelated = state.reserveIdentity("@other", 2);
    const renamed = state.reserveIdentity("@new", 1);

    expect(first.generation).toBe(1);
    expect(unrelated.generation).toBe(2);
    expect(renamed.generation).toBe(3);
    expect(state.getOwnership("@old")).toMatchObject({ userId: 1, status: "inactive" });
    expect(state.getOwnership("@new")).toMatchObject({ userId: 1, generation: 3, status: "pending" });
  });

  test("identity transition preserves playing and waiting matches", () => {
    const state = new QueueState({
      queue: [
        {
          player1: "@player",
          player2: "@opponent",
          status: "playing",
          participantIdentities: {
            "@player": { username: "@player", userId: 1, generation: 1 },
            "@opponent": { username: "@opponent", userId: 2, generation: 2 },
          },
        },
        {
          player1: "@next",
          player2: "@other",
          status: "waiting",
          participantIdentities: {
            "@next": { username: "@next", userId: 3, generation: 3 },
            "@other": { username: "@other", userId: 4, generation: 4 },
          },
        },
      ],
      ownership: {
        "@player": { userId: 1, generation: 1, status: "active" },
      },
    });
    const previousQueue = state.queue;

    const replacement = state.reserveIdentity("@player", 5);

    expect(state.queue).toEqual(previousQueue);
    expect(state.queue.map(({ status }) => status)).toEqual(["playing", "waiting"]);
    expect(state.activateIdentity(replacement).ok).toBe(true);
  });
});
