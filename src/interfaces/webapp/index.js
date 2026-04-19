import Fastify from 'fastify'
import cors from '@fastify/cors'
import staticFiles from '@fastify/static'
import { fileURLToPath } from 'url'
import { resolve, dirname } from 'path'
import { registerRoutes } from './router.js'
import { SseManager } from './sse.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Создаёт и запускает Fastify-приложение для Mini App.
 *
 * @param {object} deps
 * @param {import('node-telegram-bot-api')} deps.bot
 * @param {Function} deps.getContext
 * @param {string|null} deps.queueChatId
 * @param {Function} deps.isPauseModeEnabled
 * @param {object} deps.log
 * @returns {Promise<{ app: import('fastify').FastifyInstance, sseManager: SseManager }>}
 */
export const createWebApp = async ({ bot, getContext, queueChatId, isPauseModeEnabled, log, ...deps }) => {
  const app = Fastify({ logger: false })

  // CORS для Telegram Mini App
  await app.register(cors, {
    origin: '*',
    allowedHeaders: ['Content-Type', 'X-Telegram-Init-Data'],
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  })

  // Раздача статики собранного Mini App
  const distPath = resolve(__dirname, '../../../mini-app/dist')
  try {
    await app.register(staticFiles, {
      root: distPath,
      prefix: '/',
    })
  } catch (err) {
    log.warn('Статика Mini App недоступна (dist не собран)', { distPath, message: err.message })
  }

  const sseManager = new SseManager()

  // Подписываемся на EventNotifier чата — транслируем state_update при любом событии от бота/оркестратора
  if (queueChatId) {
    const context = getContext(queueChatId)
    if (context) {
      context.notifier.onMessage(async ({ chatId }) => {
        if (String(chatId) !== String(queueChatId)) return
        try {
          const state = await context.repository.get()
          const payload = {
            queue: state.queue,
            searching: state.searching,
            played: state.played,
            paused: isPauseModeEnabled(queueChatId),
            emergeActive: deps.emergeStateByChat ? deps.emergeStateByChat.has(String(queueChatId)) : false,
            serverTime: context.clock.now().toISOString(),
          }
          sseManager.broadcast('state_update', payload)
        } catch (err) {
          log.error('Ошибка при рассылке state_update через SSE', { message: err.message })
        }
      })
    }
  }

  // Регистрация API-маршрутов
  await registerRoutes(app, {
    bot,
    getContext,
    queueChatId,
    sseManager,
    isPauseModeEnabled,
    log,
    ...deps,
  })

  const port = Number(process.env.WEBAPP_PORT) || 3000
  await app.listen({ port, host: '0.0.0.0' })
  log.info(`WebApp сервер запущен на порту ${port}`)

  return { app, sseManager }
}
