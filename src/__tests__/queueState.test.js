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
    };

    const state = QueueState.from(raw);

    expect(state.queue[0].startDate).toBeInstanceOf(Date);
    expect(state.queue[0].endDate).toBeInstanceOf(Date);
    expect(state.played).toEqual(["@p3"]);
    expect(state.searching).toEqual(["@p4"]);
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
});


