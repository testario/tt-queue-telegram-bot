import { MongoClient } from "mongodb";
import { createNullLogger } from "../logger/Logger.js";

/**
 * Репозиторий метрик на MongoDB.
 */
class MongoUsageMetricsRepository {
  /**
   * @param {{ uri: string, dbName: string, collectionName?: string, logger?: import("../logger/Logger.js").Logger }} deps
   */
  constructor({ uri, dbName, collectionName = "usage_metrics", logger }) {
    this.uri = uri;
    this.dbName = dbName;
    this.collectionName = collectionName;
    this.logger = logger || createNullLogger();

    this.client = null;
    this.collection = null;
    this.connectPromise = null;
  }

  /**
   * Устанавливает соединение и кеширует collection.
   * @returns {Promise<import("mongodb").Collection>}
   */
  async connect() {
    if (this.collection) {
      return this.collection;
    }
    if (!this.connectPromise) {
      if (!this.uri || !this.dbName) {
        throw new Error("Отсутствуют параметры подключения к MongoDB для метрик");
      }
      this.connectPromise = (async () => {
        this.client = new MongoClient(this.uri);
        await this.client.connect();
        const db = this.client.db(this.dbName);
        this.collection = db.collection(this.collectionName);
        await this.ensureIndexes();
        this.logger.info("Подключение к MongoDB для метрик установлено", {
          db: this.dbName,
          collection: this.collectionName,
        });
        return this.collection;
      })();
    }
    return this.connectPromise;
  }

  /**
   * Создает минимально необходимые индексы.
   * @returns {Promise<void>}
   */
  async ensureIndexes() {
    if (!this.collection) return;
    await this.collection.createIndexes([
      { key: { createdAt: -1 } },
      { key: { type: 1, createdAt: -1 } },
      { key: { chatId: 1, createdAt: -1 } },
    ]);
  }

  /**
   * Сохраняет событие метрики.
   * @param {import("#application/types.js").UsageMetricEvent} event
   * @returns {Promise<void>}
   */
  async save(event) {
    const collection = await this.connect();
    await collection.insertOne({
      ...event,
      createdAt: event.createdAt || new Date(),
    });
  }

  /**
   * Возвращает агрегированную статистику.
   * @param {import("#application/types.js").UsageMetricsSummaryRequest} params
   * @returns {Promise<import("#application/types.js").UsageMetricsSummary>}
   */
  async getSummary({ from = null, to = null, limit = 20 } = {}) {
    const collection = await this.connect();
    const match = {};
    const createdAt = {};

    if (from instanceof Date && !Number.isNaN(from.getTime())) {
      createdAt.$gte = from;
    }
    if (to instanceof Date && !Number.isNaN(to.getTime())) {
      createdAt.$lte = to;
    }
    if (Object.keys(createdAt).length > 0) {
      match.createdAt = createdAt;
    }

    const [result] = await collection
      .aggregate([
        { $match: Object.keys(match).length ? match : {} },
        {
          $facet: {
            totals: [
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  first: { $min: "$createdAt" },
                  last: { $max: "$createdAt" },
                },
              },
            ],
            byType: [
              { $group: { _id: "$type", count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $limit: limit },
            ],
            inlineVariants: [
              { $match: { type: "inline:choose" } },
              { $group: { _id: "$payload.variant", count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $limit: limit },
            ],
          },
        },
      ])
      .toArray();

    const totals = result?.totals?.[0] || {};
    const byType = (result?.byType || []).map((item) => ({
      type: item._id,
      count: item.count,
    }));
    const inlineVariants = (result?.inlineVariants || []).map((item) => ({
      variant: item._id || "unknown",
      count: item.count,
    }));

    return {
      total: totals.total || 0,
      from: from || null,
      to: to || null,
      firstEventAt: totals.first || null,
      lastEventAt: totals.last || null,
      byType,
      inlineVariants,
    };
  }

  /**
   * Закрывает соединение (для graceful shutdown).
   * @returns {Promise<void>}
   */
  async close() {
    if (this.client) {
      await this.client.close();
    }
    this.client = null;
    this.collection = null;
    this.connectPromise = null;
  }
}

export { MongoUsageMetricsRepository };


