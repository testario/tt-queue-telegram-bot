import { jest } from "@jest/globals";
import { UsageMetricsService } from "#application/services/UsageMetricsService.js";

const createLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

describe("UsageMetricsService", () => {
  let repository;
  let logger;
  let service;

  beforeEach(() => {
    repository = {
      save: jest.fn(),
      getSummary: jest.fn(),
    };
    logger = createLogger();
    service = new UsageMetricsService({ repository, logger });
    jest.clearAllMocks();
  });

  test("isEnabled возвращает false без репозитория", () => {
    const disabled = new UsageMetricsService();

    expect(disabled.isEnabled()).toBe(false);
  });

  test("track возвращает disabled без репозитория", async () => {
    const disabled = new UsageMetricsService({ logger });

    const result = await disabled.track({ type: "queue" });

    expect(result).toEqual({ ok: false, reason: "disabled" });
  });

  test("track отклоняет событие без типа", async () => {
    const result = await service.track({ payload: { category: "queue" } });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid_event");
    expect(repository.save).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  test("track сохраняет нормализованное событие", async () => {
    const createdAt = new Date("2024-01-01T10:00:00Z");
    const event = {
      type: "inline:choose",
      payload: {
        category: "queue",
        variant: "quick",
        hasOpponent: true,
        ok: true,
        reason: null,
        extra: "skip_me",
        nested: { any: "value" },
      },
      createdAt,
    };

    const result = await service.track(event);

    expect(result).toEqual({ ok: true });
    expect(repository.save).toHaveBeenCalledTimes(1);
    const saved = repository.save.mock.calls[0][0];
    expect(saved.type).toBe("inline:choose");
    expect(saved.createdAt.getTime()).toBe(createdAt.getTime());
    expect(saved.payload).toEqual({
      category: "queue",
      variant: "quick",
      hasOpponent: true,
      ok: true,
      reason: null,
    });
  });

  test("track возвращает persist_error при ошибке репозитория", async () => {
    repository.save.mockRejectedValue(new Error("boom"));

    const result = await service.track({ type: "queue" });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("persist_error");
    expect(logger.error).toHaveBeenCalled();
  });

  test("getSummary возвращает disabled без репозитория", async () => {
    const disabled = new UsageMetricsService({ logger });

    const result = await disabled.getSummary();

    expect(result).toEqual({ ok: false, reason: "disabled" });
  });

  test("getSummary проксирует данные репозитория", async () => {
    const summary = {
      total: 2,
      from: null,
      to: null,
      firstEventAt: null,
      lastEventAt: null,
      byType: [{ type: "queue", count: 2 }],
      inlineVariants: [],
    };
    repository.getSummary.mockResolvedValue(summary);

    const result = await service.getSummary({ limit: 5 });

    expect(repository.getSummary).toHaveBeenCalledWith({ limit: 5 });
    expect(result).toEqual({ ok: true, summary });
  });

  test("getSummary возвращает persist_error при ошибке репозитория", async () => {
    repository.getSummary.mockRejectedValue(new Error("fail"));

    const result = await service.getSummary();

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("persist_error");
    expect(logger.error).toHaveBeenCalled();
  });
});

