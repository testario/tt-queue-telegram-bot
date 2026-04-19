import "dotenv/config";
import { createBot } from "#interfaces/telegram/bot.js";
import { parseCliOptions } from "#interfaces/cli/options.js";
import { createWebApp } from "#interfaces/webapp/index.js";
import { MongoPlayersRepository } from "#infrastructure/players/MongoPlayersRepository.js";
import { InMemoryPlayersRepository } from "#infrastructure/players/InMemoryPlayersRepository.js";

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

const botResult = createBot(token, { metricsEnabled, playersRepository });

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
}).catch((err) => {
  log.error("Не удалось запустить WebApp", { message: err.message });
});
