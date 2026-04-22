import 'dotenv/config'
import { createBot } from '#interfaces/telegram/bot.js'
import { parseCliOptions } from '#interfaces/cli/options.js'
import { createRedisClient, createRedisPubSub } from '#infrastructure/redis/createRedisClient.js'
import { RedisQueueRepository } from '#infrastructure/repositories/RedisQueueRepository.js'
import { RedisEventBus } from '#infrastructure/events/RedisEventBus.js'
import { recoverTimers } from '#infrastructure/timers/recoverTimers.js'

const token = process.env.TG_BOT_API_TOKEN
const redisUrl = process.env.REDIS_URL

if (!token) throw new Error('TG_BOT_API_TOKEN не найден в окружении')
if (!redisUrl) throw new Error('REDIS_URL обязателен для bot-процесса')

const { metricsEnabled } = parseCliOptions(process.argv.slice(2))

// Redis: отдельный клиент для хранилища + два клиента для Pub/Sub
const stateClient = await createRedisClient({ url: redisUrl })
const { publisher, subscriber } = await createRedisPubSub({ url: redisUrl })

const queueRepository = new RedisQueueRepository({ client: stateClient })

// eventBus для публикации событий из бота в Redis (subscriber не нужен боту как publisher)
const eventBus = new RedisEventBus({ publisher, subscriber: null })

const botResult = createBot(token, {
  metricsEnabled,
  playersRepository: null,   // бот записывает в MongoDB только через upsert при взаимодействии — без MongoDB ок
  queueRepository,
  eventBus,
})

const { getContext, queueChatId, isPauseModeEnabled, log } = botResult

// Восстановление таймеров из Redis после рестарта
if (queueChatId) {
  const ctx = getContext(queueChatId)
  if (ctx) {
    await recoverTimers({
      repository: ctx.repository,
      orchestrator: ctx.orchestrator,
      clock: ctx.clock,
      logger: log,
    })
  }
}

// Подписываемся на события от backend-процесса через Redis Pub/Sub.
// Когда backend создаёт матч (POST /api/match), он публикует match_created.
// Бот получает это событие и ставит таймеры через orchestrator.
const readBus = new RedisEventBus({ publisher: null, subscriber })
await readBus.subscribe(async (event) => {
  if (event.type !== 'match_created') return
  const matchRaw = event.payload?.match
  if (!matchRaw || !queueChatId) return

  const ctx = getContext(queueChatId)
  if (!ctx) return
  if (isPauseModeEnabled(queueChatId)) return

  // Восстанавливаем даты из JSON (они сериализуются как строки)
  const match = {
    ...matchRaw,
    startDate: new Date(matchRaw.startDate),
    endDate: new Date(matchRaw.endDate),
  }

  if (match.status === 'playing') {
    ctx.orchestrator.scheduleLifecycle(match)
    log.info('Bot: запланирован lifecycle для match_created из Redis', {
      player1: match.player1,
      player2: match.player2,
    })
  }
})

log.info('Bot-процесс запущен', { chatId: queueChatId })
