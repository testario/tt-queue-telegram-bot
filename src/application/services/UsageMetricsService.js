import { createNullLogger } from "#infrastructure/logger/Logger.js";

/**
 * @typedef {import("../types.js").UsageMetricEvent} UsageMetricEvent
 * @typedef {import("../types.js").UsageMetricsSummaryRequest} UsageMetricsSummaryRequest
 * @typedef {import("../types.js").UsageMetricsSummary} UsageMetricsSummary
 * @typedef {import("../types.js").UsageMetricsRepository} UsageMetricsRepository
 * @typedef {import("../types.js").Logger} Logger
 */

/**
 * Сервис для записи и агрегации метрик использования.
 * Работает поверх абстрактного репозитория (Mongo и т.п.).
 */
class UsageMetricsService {
  /**
   * @param {{ repository?: UsageMetricsRepository|null, logger?: Logger }} [deps]
   */
  constructor({ repository = null, logger } = {}) {
    this.repository = repository;
    this.logger = logger || createNullLogger();
  }

  /**
   * Признак доступности метрик (есть подключенный репозиторий).
   * @returns {boolean}
   */
  isEnabled() {
    return Boolean(this.repository);
  }

  /**
   * Приводит входное событие к нормализованной форме для хранения.
   * @param {UsageMetricEvent} event
   * @returns {UsageMetricEvent}
   */
  normalizeEvent(event) {
    const createdAt = event.createdAt ? new Date(event.createdAt) : new Date();
    const allowedKeys = [
      "category",
      "variant",
      "hasContext",
      "hasRange",
      "hasOpponent",
      "ok",
      "reason",
      "restarted",
    ];
    const payload =
      event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
        ? Object.entries(event.payload).reduce((acc, [key, value]) => {
            if (!allowedKeys.includes(key)) return acc;
            if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
              acc[key] = value;
              return acc;
            }
            if (value === null || value === undefined) {
              acc[key] = null;
            }
            return acc;
          }, {})
        : {};

    return {
      type: event.type,
      payload,
      createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
    };
  }

  /**
   * Фиксирует событие использования.
   * @param {UsageMetricEvent} event
   * @returns {Promise<{ ok: boolean, reason?: string }>}
   */
  async track(event) {
    if (!this.isEnabled()) {
      return { ok: false, reason: "disabled" };
    }
    if (!event || !event.type) {
      this.logger.warn("Попытка записать метрику без типа");
      return { ok: false, reason: "invalid_event" };
    }

    const normalized = this.normalizeEvent(event);
    try {
      await this.repository.save(normalized);
      return { ok: true };
    } catch (error) {
      this.logger.error("Не удалось сохранить метрику", {
        message: error.message,
        type: event.type,
      });
      return { ok: false, reason: "persist_error" };
    }
  }

  /**
   * Возвращает агрегированные метрики за период.
   * @param {UsageMetricsSummaryRequest} [request]
   * @returns {Promise<{ ok: true, summary: UsageMetricsSummary } | { ok: false, reason: string }>}
   */
  async getSummary(request = {}) {
    if (!this.isEnabled()) {
      return { ok: false, reason: "disabled" };
    }
    try {
      const summary = await this.repository.getSummary(request);
      return { ok: true, summary };
    } catch (error) {
      this.logger.error("Не удалось получить метрики", { message: error.message });
      return { ok: false, reason: "persist_error" };
    }
  }
}

export { UsageMetricsService };


