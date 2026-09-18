import 'dotenv/config'
import { rmSync, writeFileSync } from 'fs'
import { createBot } from '#interfaces/telegram/bot.js'
import { parseCliOptions } from '#interfaces/cli/options.js'
import { createRedisClient, createRedisPubSub } from '#infrastructure/redis/createRedisClient.js'
import { RedisQueueRepository } from '#infrastructure/repositories/RedisQueueRepository.js'
import { RedisEventBus } from '#infrastructure/events/RedisEventBus.js'
import { RedisInvitesStore } from '#infrastructure/invites/RedisInvitesStore.js'
import { MongoPlayersRepository } from '#infrastructure/players/MongoPlayersRepository.js'
import { InMemoryPlayersRepository } from '#infrastructure/players/InMemoryPlayersRepository.js'
import { LifecycleReconciler } from '#infrastructure/timers/LifecycleReconciler.js'
import { getPlayersMongoConfig } from '#infrastructure/players/config.js'
import { migrateQueueState } from '#application/usecases/MigrateQueueState.js'

const token = process.env.TG_BOT_API_TOKEN
const redisUrl = process.env.REDIS_URL

if (!token) throw new Error('TG_BOT_API_TOKEN не найден в окружении')
if (!redisUrl) throw new Error('REDIS_URL обязателен для bot-процесса')

const { metricsEnabled } = parseCliOptions(process.argv.slice(2))

// Redis: отдельный клиент для хранилища + два клиента для Pub/Sub
const stateClient = await createRedisClient({ url: redisUrl })
const { publisher, subscriber } = await createRedisPubSub({ url: redisUrl })

const queueRepository = new RedisQueueRepository({ client: stateClient })
const invitesStore = new RedisInvitesStore({ client: stateClient })

// Хранилище игроков: те же MongoDB defaults, что и в backend-процессе.
const { uri: playersMongoUri, dbName: playersMongoDb, collectionName: playersMongoCollection } =
  getPlayersMongoConfig()
const playersRepository = playersMongoUri
  ? new MongoPlayersRepository({
      uri: playersMongoUri,
      dbName: playersMongoDb,
      collectionName: playersMongoCollection,
    })
  : new InMemoryPlayersRepository()

if (playersMongoUri && playersRepository.connect) {
  await playersRepository.connect()
}

// Legacy participant identity cannot be proved. Migrate durable state before
// createBot installs handlers, lifecycle recovery, or polling.
await migrateQueueState({ repository: queueRepository, playersRepository })

// eventBus для публикации событий из бота в Redis (subscriber не нужен боту как publisher)
const eventBus = new RedisEventBus({ publisher, subscriber: null })

let lifecycleReconciler = null
const botResult = createBot(token, {
  metricsEnabled,
  playersRepository,
  queueRepository,
  eventBus,
  invitesStore,
  lifecycleManagedExternally: true,
  autoStartPolling: false,
  onDispose: () => lifecycleReconciler?.dispose(),
  onStop: () => shutdown(),
  onQueueChanged: () => lifecycleReconciler?.wake(),
})

const {
  getContext,
  queueChatId,
  shouldHoldMatch,
  log,
  startPolling,
  dispose: disposeBot,
} = botResult

const ctx = queueChatId ? getContext(queueChatId) : null
if (!ctx) throw new Error('Контекст очереди не найден для bot-процесса')

lifecycleReconciler = new LifecycleReconciler({
  repository: ctx.repository,
  orchestrator: ctx.orchestrator,
  clock: ctx.clock,
  logger: log,
  shouldHold: (match, now) => shouldHoldMatch(queueChatId, match, now),
})

// Pub/Sub используется только как сигнал перечитать durable-состояние.
const readBus = new RedisEventBus({ publisher: null, subscriber, sourceId: eventBus.sourceId })
await readBus.subscribe(async (event) => {
  if (event.sourceId === eventBus.sourceId) return
  if (!queueChatId) return
  if (event.chatId && String(event.chatId) !== String(queueChatId)) return
  lifecycleReconciler.wake()
})

const closeResource = async (name, close) => {
  if (typeof close !== 'function') return
  try {
    await Promise.race([
      Promise.resolve().then(close),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ])
  } catch (error) {
    log.error(`Не удалось закрыть ${name}`, { message: error.message })
  }
}

const closeClient = (client) => {
  if (!client) return undefined
  if (typeof client.quit === 'function') return () => client.quit()
  if (typeof client.disconnect === 'function') return () => client.disconnect()
  return undefined
}

let shutdownPromise = null
const shutdown = () => {
  if (shutdownPromise) return shutdownPromise
  shutdownPromise = (async () => {
    await disposeBot()
    await closeResource('Redis wakeup', () => readBus.unsubscribe())
    await closeResource('Redis state client', closeClient(stateClient))
    await closeResource('Redis publisher', closeClient(publisher))
    await closeResource('Redis subscriber', closeClient(subscriber))
    await closeResource('Mongo players repository', () => playersRepository.close?.())
    try {
      rmSync('/tmp/bot-alive', { force: true })
    } catch (error) {
      log.error('Не удалось удалить health marker', { message: error.message })
    }
  })()
  return shutdownPromise
}

let exitStarted = false
const handleSignal = (signal) => {
  if (exitStarted) return
  exitStarted = true
  void shutdown().then(
    () => process.exit(0),
    (error) => {
      log.error(`Ошибка завершения по ${signal}`, { message: error.message })
      process.exit(1)
    }
  )
}
process.once('SIGTERM', () => handleSignal('SIGTERM'))
process.once('SIGINT', () => handleSignal('SIGINT'))

// Порядок важен: сначала принимаем wakeup, затем сверяем durable-state, затем polling.
await lifecycleReconciler.reconcile()
lifecycleReconciler.start()
await startPolling()

log.info('Bot-процесс запущен', { chatId: queueChatId })
// Healthcheck для Docker: сигнализирует, что процесс успешно запустился
writeFileSync('/tmp/bot-alive', Date.now().toString())
