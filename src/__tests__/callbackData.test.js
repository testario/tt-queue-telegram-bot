import { parseCallbackData } from "#application/parsers/callbackData.js";

describe("parseCallbackData", () => {
  test("разбирает идентификаторы турнирного приглашения и матча", () => {
    expect(parseCallbackData("tournament_accept:t-12")).toEqual({
      type: "tournament_accept",
      invitationId: "t-12",
    });
    expect(parseCallbackData("tournament_finish:match-34")).toEqual({
      type: "tournament_finish",
      matchId: "match-34",
    });
  });
});
