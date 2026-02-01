import { createLocalization } from "#application/messages/localization.js";
import { TIME_AFTER_EMERGE } from "#application/config/time.js";
import { formatReadyTime } from "#application/messages/locales/utils.js";

describe("Pause mode messages", () => {
  test("pauseModeEnabled сообщает о доигрывании текущей пары", () => {
    const { messages } = createLocalization({ locale: "ru" });
    const text = messages.pauseModeEnabled({
      action: "continue",
      player1: "@p1",
      player2: "@p2",
    });

    expect(text).toContain("@p1");
    expect(text).toContain("@p2");
    expect(text).toContain("доигрывает");
  });

  test("pauseModeEnabled сообщает об остановке текущей пары", () => {
    const { messages } = createLocalization({ locale: "ru" });
    const text = messages.pauseModeEnabled({
      action: "stop",
      player1: "@p1",
      player2: "@p2",
    });

    expect(text).toContain("@p1");
    expect(text).toContain("@p2");
    expect(text).toContain("остановлен");
  });

  test("pauseModeEnabled сообщает об отсутствии активной пары", () => {
    const { messages } = createLocalization({ locale: "ru" });
    const text = messages.pauseModeEnabled({ action: "none" });

    expect(text).toContain("Активной пары");
  });

  test("emergeTooLate использует TIME_AFTER_EMERGE в сообщении", () => {
    const { messages } = createLocalization({ locale: "ru" });
    const expected = formatReadyTime(TIME_AFTER_EMERGE, "ru");
    const text = messages.emergeTooLate({ player1: "@p1", player2: "@p2" });

    expect(text).toContain(expected);
  });
});
