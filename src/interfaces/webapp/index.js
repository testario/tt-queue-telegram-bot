import Fastify from 'fastify'
import cors from '@fastify/cors'
import staticFiles from '@fastify/static'
import { fileURLToPath } from 'url'
import { resolve, dirname } from 'path'
import { registerRoutes } from './router.js'
import { SseManager } from './sse.js'
import { QueueService } from '#domain/services/QueueService.js'
import { SystemClock } from '#infrastructure/time/SystemClock.js'
import { EventNotifier } from '#infrastructure/notifier/EventNotifier.js'
import { RegisterSearch } from '#application/usecases/RegisterSearch.js'
import { CancelSearch } from '#application/usecases/CancelSearch.js'
import { AddMatch } from '#application/usecases/AddMatch.js'
import { CancelMatch } from '#application/usecases/CancelMatch.js'
import { CreateDirectMatch } from '#application/usecases/CreateDirectMatch.js'
import { GetQueue } from '#application/usecases/GetQueue.js'
import { GetPlayed } from '#application/usecases/GetPlayed.js'
import { createLocalization } from '#application/messages/localization.js'
import { I18N_CONFIG } from '#application/config/i18n.js'
import { DEFAULT_GAME_TIME, TIME_READY, WORK_SCHEDULE } from '#application/config/time.js'
import { Match } from '#domain'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Строит контекст всех use-case для backend-only режима.
 * Вместо MatchOrchestrator использует null-объект: lifecycle-таймеры ставит bot-процесс
 * через Redis Pub/Sub (получает match_created и вызывает scheduleLifecycle).
 */
const buildBackendContext = ({ queueRepository, queueChatId, messages, eventBus }) => {
  const queueService = new QueueService({
    readyMs: TIME_READY,
    gameMs: DEFAULT_GAME_TIME,
    workSchedule: WORK_SCHEDULE,
  })
  const clock = new SystemClock()
  const notifier = new EventNotifier({ eventBus })

  // Null-orchestrator: lifecycle и отмена таймеров — ответственность bot-процесса
  const nullOrchestrator = {
    scheduleLifecycle: () => {},
    scheduleFinish: () => {},
    cancelAll: () => {},
    cancelForMatch: () => {},
  }

  const registerSearch = new RegisterSearch({ repository: queueRepository, queueService, messages, clock })
  const cancelSearch = new CancelSearch({ repository: queueRepository, queueService, messages, clock })
  const addMatch = new AddMatch({
    chatId: queueChatId,
    repository: queueRepository,
    queueService,
    orchestrator: nullOrchestrator,
    notifier,
    messages,
    clock,
  })
  const cancelMatch = new CancelMatch({
    chatId: queueChatId,
    repository: queueRepository,
    queueService,
    orchestrator: nullOrchestrator,
    notifier,
    messages,
    clock,
  })
  const directMatch = new CreateDirectMatch({
    registerSearch,
    repository: queueRepository,
    queueService,
    clock,
    messages,
  })
  const getQueue = new GetQueue({ repository: queueRepository, messages })
  const getPlayed = new GetPlayed({ repository: queueRepository, queueService, messages, clock })

  return {
    chatId: queueChatId,
    queueService,
    repository: queueRepository,
    notifier,
    clock,
    orchestrator: nullOrchestrator,
    registerSearch,
    addMatch,
    directMatch,
    cancelSearch,
    cancelMatch,
    getQueue,
    getPlayed,
    inlineMessageId: null,
  }
}

/**
 * Строит минимальные реализации pause/emerge-функций для backend-only режима.
 * Состояние хранится in-process (не синхронизируется с bot-процессом).
 * Для полной синхронизации паузы между процессами потребуется Redis-хранилище
 * (за рамками текущей фазы).
 */
const buildLocalAdminState = ({ queueChatId, bot, messages, queueService }) => {
  const pauseModeChats = new Set()
  const emergeStateByChat = new Map()

  const isPauseModeEnabled = (chatId) => pauseModeChats.has(String(chatId))
  const setPauseMode = (chatId, enabled) => {
    if (enabled) pauseModeChats.add(String(chatId))
    else pauseModeChats.delete(String(chatId))
  }

  const applyPauseMode = async ({ chatId, context }) => {
    setPauseMode(chatId, true)
    const state = await context.repository.get()
    if (state.queue.length) {
      state.queue.forEach((item, i) => {
        if (i > 0) item.status = Match.statuses.waiting
      })
      await context.repository.save(state)
    }
    bot.sendMessage(chatId, messages.pauseModeEnabled({ action: 'none' })).catch(() => {})
  }

  const resumeQueueAfterPause = async (context) => {
    if (!context) return { hasQueue: false }
    const state = await context.repository.get()
    if (!state.queue.length) return { hasQueue: false }
    const now = context.clock.now()
    const nextMatch = state.queue[0]
    const isCurrentPlaying =
      nextMatch.status === Match.statuses.playing && now >= nextMatch.startDate
    if (isCurrentPlaying) {
      return { hasQueue: true, currentMatchContinues: true, currentMatch: nextMatch }
    }
    nextMatch.status = Match.statuses.playing
    nextMatch.startDate = new Date(now.getTime() + queueService.readyMs)
    nextMatch.endDate = new Date(nextMatch.startDate.getTime() + queueService.gameMs)
    queueService.recalculateWaiting(state)
    await context.repository.save(state)
    // Bot-процесс поставит таймеры, получив state_update через Redis
    return { hasQueue: true, nextMatch }
  }

  // В backend-only режиме emerge-состояние не отслеживается между процессами
  const resumeEmergeAfterContinue = async (_deps) => ({ handled: false })

  const handleEmerge = async ({ chatId, context, userId }) => {
    try {
      const member = await bot.getChatMember(chatId, userId)
      if (!['administrator', 'creator'].includes(member?.status)) {
        bot.sendMessage(chatId, messages.adminOnly()).catch(() => {})
        return
      }
    } catch {
      bot.sendMessage(chatId, messages.adminOnly()).catch(() => {})
      return
    }
    await applyPauseMode({ chatId, context })
  }

  return {
    isPauseModeEnabled,
    setPauseMode,
    emergeStateByChat,
    applyPauseMode,
    resumeQueueAfterPause,
    resumeEmergeAfterContinue,
    handleEmerge,
  }
}

/**
 * Создаёт и запускает Fastify-приложение для Mini App.
 *
 * Поддерживает два режима:
 * - All-in-one: передаётся `getContext` из `createBot` со всеми зависимостями
 * - Backend-only: передаётся `queueRepository` напрямую; контекст строится внутри
 *
 * @param {object} deps
 * @param {import('node-telegram-bot-api')} deps.bot
 * @param {Function} [deps.getContext]      — all-in-one: функция получения контекста чата
 * @param {string|null} [deps.queueChatId]
 * @param {Function} [deps.isPauseModeEnabled]
 * @param {Function} [deps.setPauseMode]
 * @param {Map} [deps.emergeStateByChat]
 * @param {Function} [deps.applyPauseMode]
 * @param {Function} [deps.resumeEmergeAfterContinue]
 * @param {Function} [deps.resumeQueueAfterPause]
 * @param {Function} [deps.handleEmerge]
 * @param {object} [deps.messages]
 * @param {object} [deps.ui]
 * @param {object} [deps.queueRepository]   — backend-only: репозиторий очереди напрямую
 * @param {object} [deps.eventBus]          — Redis EventBus для SSE и публикации событий
 * @param {object} [deps.invitesStore]
 * @param {object} [deps.playersRepository]
 * @param {object} deps.log
 * @returns {Promise<{ app: import('fastify').FastifyInstance, sseManager: SseManager }>}
 */
export const createWebApp = async ({
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
  queueRepository,
  eventBus,
  invitesStore,
  playersRepository,
  log,
}) => {
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

  // Backend-only режим: строим контекст и admin-state из queueRepository
  let resolvedGetContext = getContext
  let resolvedMessages = messages
  let resolvedUi = ui
  let resolvedIsPauseModeEnabled = isPauseModeEnabled
  let resolvedSetPauseMode = setPauseMode
  let resolvedEmergeStateByChat = emergeStateByChat
  let resolvedApplyPauseMode = applyPauseMode
  let resolvedResumeEmerge = resumeEmergeAfterContinue
  let resolvedResumeQueue = resumeQueueAfterPause
  let resolvedHandleEmerge = handleEmerge

  if (queueRepository) {
    const loc = createLocalization(I18N_CONFIG)
    resolvedMessages = loc.messages
    resolvedUi = loc.ui

    const backendContext = buildBackendContext({
      queueRepository,
      queueChatId,
      messages: resolvedMessages,
      eventBus,
    })
    resolvedGetContext = (_chatId) => backendContext

    const adminState = buildLocalAdminState({
      queueChatId,
      bot,
      messages: resolvedMessages,
      queueService: backendContext.queueService,
    })
    resolvedIsPauseModeEnabled = adminState.isPauseModeEnabled
    resolvedSetPauseMode = adminState.setPauseMode
    resolvedEmergeStateByChat = adminState.emergeStateByChat
    resolvedApplyPauseMode = adminState.applyPauseMode
    resolvedResumeEmerge = adminState.resumeEmergeAfterContinue
    resolvedResumeQueue = adminState.resumeQueueAfterPause
    resolvedHandleEmerge = adminState.handleEmerge
  }

  const sseManager = new SseManager()

  // Функция получения текущего состояния для SSE-рассылки
  const resolvedContext = resolvedGetContext ? resolvedGetContext(queueChatId) : null
  const buildStatePayload = async () => {
    if (!resolvedContext) return {}
    const state = await resolvedContext.repository.get()
    return {
      queue: state.queue,
      searching: state.searching,
      played: state.played,
      paused: resolvedIsPauseModeEnabled ? resolvedIsPauseModeEnabled(queueChatId) : false,
      emergeActive: resolvedEmergeStateByChat
        ? resolvedEmergeStateByChat.has(String(queueChatId))
        : false,
      serverTime: resolvedContext.clock.now().toISOString(),
      pendingInvites: invitesStore ? await invitesStore.getAll() : [],
    }
  }

  // Подписываемся на источник событий:
  // - backend-only (eventBus + queueRepository): Redis Pub/Sub → SSE
  // - all-in-one: EventNotifier → SSE
  if (eventBus && queueRepository) {
    await sseManager.subscribeToRedis(eventBus, buildStatePayload)
  } else if (resolvedContext) {
    resolvedContext.notifier.onMessage(async ({ chatId }) => {
      if (String(chatId) !== String(queueChatId)) return
      try {
        sseManager.broadcast('state_update', await buildStatePayload())
      } catch (err) {
        log.error('Ошибка при рассылке state_update через SSE', { message: err.message })
      }
    })
  }

  // Регистрация API-маршрутов
  await registerRoutes(app, {
    bot,
    getContext: resolvedGetContext,
    queueChatId,
    sseManager,
    isPauseModeEnabled: resolvedIsPauseModeEnabled,
    setPauseMode: resolvedSetPauseMode,
    emergeStateByChat: resolvedEmergeStateByChat,
    applyPauseMode: resolvedApplyPauseMode,
    resumeEmergeAfterContinue: resolvedResumeEmerge,
    resumeQueueAfterPause: resolvedResumeQueue,
    handleEmerge: resolvedHandleEmerge,
    messages: resolvedMessages,
    ui: resolvedUi,
    log,
    invitesStore,
    playersRepository,
  })

  const port = Number(process.env.WEBAPP_PORT) || 3000
  await app.listen({ port, host: '0.0.0.0' })
  log.info(`WebApp сервер запущен на порту ${port}`)

  return { app, sseManager }
}
