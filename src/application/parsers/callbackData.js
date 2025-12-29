const playWithPrefix = "i_want_to_play_with_:";
const cancelSearchPrefix = "i_want_to_cancel:";
const cancelMatchPrefix = "i_want_to_out:";
const testPrefix = "i_want_to_test:";
const inlineTestPrefix = "inline_test:";

/**
 * Разбирает payload callback-кнопки и возвращает структурированное действие.
 * Поддерживает поиск соперника, отмену поиска/матча и тестовые сценарии.
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
  return { type: "unknown" };
};

export { parseCallbackData };

