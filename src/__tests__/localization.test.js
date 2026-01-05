import { createLocalization } from "#application/messages/localization.js";

describe("Localization", () => {
  test("возвращает запрошенную локаль (es)", () => {
    const { locale, messages, ui } = createLocalization({ locale: "es" });

    expect(locale).toBe("es");
    expect(messages.searchCancelled()).toBe("El jugador cambió de opinión");
    expect(ui.inline.playWith).toBe("¡Quiero jugar!");
  });

  test("использует fallback, если локаль не найдена", () => {
    const { locale, messages } = createLocalization({ locale: "xx", fallbackLocale: "en" });

    expect(locale).toBe("en");
    expect(messages.botStopped()).toContain("Bot stopped");
  });

  test("локаль ru остаётся дефолтной при отсутствии fallback", () => {
    const { locale, messages } = createLocalization({ locale: "unknown" });

    expect(locale).toBe("ru");
    expect(messages.searchCancelled()).toBe("Игрок передумал");
  });
});

