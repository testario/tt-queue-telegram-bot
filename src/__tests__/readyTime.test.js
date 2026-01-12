import { formatReadyTime } from "#application/messages/locales/utils.js";

describe("formatReadyTime", () => {
  test("форматирует секунды", () => {
    expect(formatReadyTime(30_000)).toBe("30 секунд");
  });

  test("форматирует минуты", () => {
    expect(formatReadyTime(60_000)).toBe("1 минута");
  });

  test("форматирует часы", () => {
    expect(formatReadyTime(2 * 3_600_000)).toBe("2 часа");
  });

  test("использует fallback при отсутствии Intl", async () => {
    const originalIntl = global.Intl;

    try {
      // Эмулируем окружение без Intl, чтобы проверить запасной форматтер.
      // eslint-disable-next-line no-global-assign
      Intl = undefined;

      // Принудительно берём новый модуль (включая query), чтобы обойти кэш ESM.
      const { formatReadyTime: isolatedFormat } = await import(
        "../application/messages/locales/utils.js?forceFallbackTest=1"
      );
      expect(isolatedFormat(30_000)).toBe("30 секунд");
    } finally {
      // eslint-disable-next-line no-global-assign
      Intl = originalIntl;
    }
  });
});


