const playWithPrefix = "i_want_to_play_with_:";
const cancelSearchPrefix = "i_want_to_cancel:";
const cancelMatchPrefix = "i_want_to_out:";
const testPrefix = "i_want_to_test:";
const inlineTestPrefix = "inline_test:";
const directAcceptPrefix = "direct_accept:";
const directDeclinePrefix = "direct_decline:";
const directCancelPrefix = "direct_cancel:";

/**
 * @typedef {Object} PlayWithData
 * @property {"play_with"} type
 * @property {string} player
 *
 * @typedef {Object} CancelSearchData
 * @property {"cancel_search"} type
 * @property {string} player
 *
 * @typedef {Object} CancelMatchData
 * @property {"cancel_match"} type
 * @property {string[]} players
 *
 * @typedef {Object} TestData
 * @property {"test"} type
 * @property {string} player
 * @property {number} count
 *
 * @typedef {Object} InlineTestData
 * @property {"inline_test"} type
 * @property {number} count
 *
 * @typedef {Object} DirectAcceptData
 * @property {"direct_accept"} type
 * @property {string[]} players
 *
 * @typedef {Object} DirectDeclineData
 * @property {"direct_decline"} type
 * @property {string[]} players
 *
 * @typedef {Object} DirectCancelData
 * @property {"direct_cancel"} type
 * @property {string[]} players
 *
 * @typedef {Object} UnknownData
 * @property {"unknown"} type
 *
 * @typedef {PlayWithData | CancelSearchData | CancelMatchData | TestData | InlineTestData | DirectAcceptData | DirectDeclineData | DirectCancelData | UnknownData} ParsedCallbackData
 */

/**
 * Разбирает payload callback-кнопки и возвращает структурированное действие.
 * Поддерживает поиск соперника, отмену поиска/матча и тестовые сценарии.
 * @param {string} data
 * @returns {ParsedCallbackData}
 */
const parseCallbackData = (data) => {
  if (data.startsWith(playWithPrefix)) {
    return { type: "play_with", player: data.split(":").pop() };
  }
  if (data.startsWith(cancelSearchPrefix)) {
    return { type: "cancel_search", player: data.split(":").pop() };
  }
  if (data.startsWith(cancelMatchPrefix)) {
    const payload = data.split(":").pop();
    const players = payload.split(",").filter(Boolean);
    return { type: "cancel_match", players };
  }
  if (data.startsWith(testPrefix)) {
    const [, player, rawCount] = data.split(":");
    const count = Number.isFinite(Number(rawCount)) && Number(rawCount) > 0 ? Number(rawCount) : 1;
    return { type: "test", player, count };
  }
  if (data.startsWith(inlineTestPrefix)) {
    const [, rawCount] = data.split(":");
    const count = Number.isFinite(Number(rawCount)) && Number(rawCount) > 0 ? Number(rawCount) : 1;
    return { type: "inline_test", count };
  }
  if (data.startsWith(directAcceptPrefix)) {
    const payload = data.split(":").pop();
    const players = (payload || "").split(",").filter(Boolean);
    return { type: "direct_accept", players };
  }
  if (data.startsWith(directDeclinePrefix)) {
    const payload = data.split(":").pop();
    const players = (payload || "").split(",").filter(Boolean);
    return { type: "direct_decline", players };
  }
  if (data.startsWith(directCancelPrefix)) {
    const payload = data.split(":").pop();
    const players = (payload || "").split(",").filter(Boolean);
    return { type: "direct_cancel", players };
  }
  return { type: "unknown" };
};

export { parseCallbackData };

