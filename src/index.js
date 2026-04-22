import "dotenv/config";
import { createBot } from "#interfaces/telegram/bot.js";
import { parseCliOptions } from "#interfaces/cli/options.js";
import { createWebApp } from "#interfaces/webapp/index.js";
import { MongoPlayersRepository } from "#infrastructure/players/MongoPlayersRepository.js";
import { InMemoryPlayersRepository } from "#infrastructure/players/InMemoryPlayersRepository.js";
import { createRedisClient, createRedisPubSub } from "#infrastructure/redis/createRedisClient.js";
import { RedisQueueRepository } from "#infrastructure/repositories/RedisQueueRepository.js";
import { recoverTimers } from "#infrastructure/timers/recoverTimers.js";
import { RedisEventBus } from "#infrastructure/events/RedisEventBus.js";
import { RedisInvitesStore } from "#infrastructure/invites/RedisInvitesStore.js";
import { InMemoryInvitesStore } from "#infrastructure/invites/InMemoryInvitesStore.js";

const token = process.env.TG_BOT_API_TOKEN;
const { metricsEnabled } = parseCliOptions(process.argv.slice(2));

if (!token) {
  throw new Error("TG_BOT_API_TOKEN не найден в окружении");
}

// Хранилище игроков: MongoDB если задан URI, иначе in-memory
const playersMongoUri =
  process.env.PLAYERS_MONGODB_URI || process.env.MONGODB_URI || null;
const playersMongoDb =
  process.env.PLAYERS_MONGODB_DB || process.env.MONGODB_DB || "tt-queue-bot";
const playersMongoCollection =
  process.env.PLAYERS_MONGODB_COLLECTION || "players";

const playersRepository = playersMongoUri
  ? new MongoPlayersRepository({
      uri: playersMongoUri,
      dbName: playersMongoDb,
      collectionName: playersMongoCollection,
    })
  : new InMemoryPlayersRepository();

if (playersMongoUri && playersRepository.connect) {
  await playersRepository.connect();
}

// Хранилище очереди + Pub/Sub + InvitesStore: Redis если задан REDIS_URL, иначе in-memory
const redisUrl = process.env.REDIS_URL || null;
let redisClient = null;
let queueRepository = null;
let eventBus = null;
let invitesStore = new InMemoryInvitesStore();

if (redisUrl) {
  redisClient = await createRedisClient({ url: redisUrl });
  queueRepository = new RedisQueueRepository({ client: redisClient });

  const { publisher, subscriber } = await createRedisPubSub({ url: redisUrl });
  eventBus = new RedisEventBus({ publisher, subscriber });
  invitesStore = new RedisInvitesStore({ client: redisClient });
}

const botResult = createBot(token, { metricsEnabled, playersRepository, queueRepository, eventBus });

const {
  bot,
  getContext,
  queueChatId,
  isPauseModeEnabled,
  setPauseMode,
  emergeStateByChat,
  applyPauseMode,
  resumeEmergeAfterContinue,
  resumeQueueAfterPause,
  handleEmerge,
  messages,
  ui,
  log,
} = botResult;

// Восстанавливаем таймеры из Redis после старта (если Redis включён)
if (redisClient && queueChatId) {
  const ctx = getContext(queueChatId);
  if (ctx) {
    await recoverTimers({
      repository: ctx.repository,
      orchestrator: ctx.orchestrator,
      clock: ctx.clock,
      logger: log,
    });
  }
}

createWebApp({
  bot,
  getContext,
  queueChatId,
  isPauseModeEnabled,
  setPauseMode,
  emergeStateByChat,
  applyPauseMode,
  resumeEmergeAfterContinue,
  resumeQueueAfterPause,
  handleEmerge,
  messages,
  ui,
  log,
  playersRepository,
  invitesStore,
  eventBus,
}).catch((err) => {
  log.error("Не удалось запустить WebApp", { message: err.message });
});
