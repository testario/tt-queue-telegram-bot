import 'dotenv/config'
import TelegramApi from 'node-telegram-bot-api'
import { createWebApp } from '#interfaces/webapp/index.js'
import { MongoPlayersRepository } from '#infrastructure/players/MongoPlayersRepository.js'
import { InMemoryPlayersRepository } from '#infrastructure/players/InMemoryPlayersRepository.js'
import { createRedisClient, createRedisPubSub } from '#infrastructure/redis/createRedisClient.js'
import { RedisQueueRepository } from '#infrastructure/repositories/RedisQueueRepository.js'
import { RedisEventBus } from '#infrastructure/events/RedisEventBus.js'
import { RedisInvitesStore } from '#infrastructure/invites/RedisInvitesStore.js'
import { createLogger } from '#infrastructure/logger/Logger.js'

const log = createLogger({ prefix: 'backend' })
const redisUrl = process.env.REDIS_URL
const token = process.env.TG_BOT_API_TOKEN

if (!redisUrl) throw new Error('REDIS_URL обязателен для backend-процесса')
if (!token) throw new Error('TG_BOT_API_TOKEN обязателен для backend-процесса')

// Redis: клиент для хранилища + два клиента для Pub/Sub
const stateClient = await createRedisClient({ url: redisUrl, logger: log })
const { publisher, subscriber } = await createRedisPubSub({ url: redisUrl, logger: log })

const queueRepository = new RedisQueueRepository({ client: stateClient, logger: log })
// publisher — для публикации событий из backend (notifier.notify → eventBus.publish)
// subscriber — для подписки на события от bot-процесса (SSE-broadcast)
const eventBus = new RedisEventBus({ publisher, subscriber })
const invitesStore = new RedisInvitesStore({ client: stateClient })

// MongoDB для списка игроков (нужен для /api/players и аватаров)
const playersMongoUri = process.env.PLAYERS_MONGODB_URI || process.env.MONGODB_URI || null
const playersRepository = playersMongoUri
  ? new MongoPlayersRepository({
      uri: playersMongoUri,
      dbName: process.env.PLAYERS_MONGODB_DB || process.env.MONGODB_DB || 'tt-queue-bot',
      collectionName: process.env.PLAYERS_MONGODB_COLLECTION || 'players',
    })
  : new InMemoryPlayersRepository()

if (playersMongoUri && playersRepository.connect) {
  await playersRepository.connect()
}

// Минимальный TelegramApi без polling — только для API-запросов:
// getChatMember (проверка прав admin), sendMessage (уведомления в чат), getUserProfilePhotos (аватары)
const tgApi = new TelegramApi(token)

await createWebApp({
  bot: tgApi,
  queueRepository,
  eventBus,
  invitesStore,
  playersRepository,
  queueChatId: process.env.TG_CHAT_ID,
  log,
})

log.info('Backend-процесс запущен')
