import { TournamentFeature } from "#application/features/tournament/TournamentFeature.js";

describe("TournamentFeature", () => {
  test("включает режим отдельно для каждого чата", () => {
    const feature = new TournamentFeature();

    expect(feature.enable(1)).toBe(true);
    expect(feature.isEnabled(1)).toBe(true);
    expect(feature.isEnabled(2)).toBe(false);
    expect(feature.enable(1)).toBe(false);
  });

  test("не дает использовать приглашение из другого чата и удаляет его при выключении", () => {
    const feature = new TournamentFeature();
    feature.enable(1);
    const invitationId = feature.createInvite(1, { player: "@p1", opponent: "@p2" });

    expect(feature.getInvite(2, invitationId)).toBeNull();
    expect(feature.getInvite(1, invitationId)).toEqual({ player: "@p1", opponent: "@p2" });

    feature.disable(1);
    expect(feature.getInvite(1, invitationId)).toBeNull();
  });

  test("удаляет непринятое приглашение по таймеру", () => {
    const scheduled = [];
    const feature = new TournamentFeature({
      getInviteExpiration: (now) => new Date(now.getTime() + 60 * 1000),
      schedule: (callback, delayMs) => {
        scheduled.push({ callback, delayMs });
        return scheduled.length;
      },
      cancel: () => {},
    });

    const invitationId = feature.createInvite(1, { player: "@p1", opponent: "@p2" });

    expect(scheduled[0].delayMs).toBe(60 * 1000);
    scheduled[0].callback();
    expect(feature.getInvite(1, invitationId)).toBeNull();
  });
});
