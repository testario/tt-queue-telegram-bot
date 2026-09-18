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
import { ClaimPlayerIdentity } from '#application/usecases/ClaimPlayerIdentity.js'
import { AddMatch } from '#application/usecases/AddMatch.js'
import { CancelMatch } from '#application/usecases/CancelMatch.js'
import { CreateDirectMatch } from '#application/usecases/CreateDirectMatch.js'
import { GetQueue } from '#application/usecases/GetQueue.js'
import { GetPlayed } from '#application/usecases/GetPlayed.js'
import { createLocalization } from '#application/messages/localization.js'
import { I18N_CONFIG } from '#application/config/i18n.js'
import { DEFAULT_GAME_TIME, TIME_READY, WORK_SCHEDULE } from '#application/config/time.js'
import { Match } from '#domain'
import { buildMatchCancelKeyboard } from '#interfaces/telegram/keyboards.js'
import { updateQueueState, QueueStateConflictError } from '#application/usecases/queueStateCas.js'
import { toPublicState } from './publicDtos.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Строит контекст всех use-case для backend-only режима.
 * Вместо MatchOrchestrator использует null-объект: lifecycle-таймеры ставит bot-процесс,
 * а backend отправляет Telegram-анонс созданного матча.
 */
export const buildBackendContext = ({ queueRepository, queueChatId, messages, ui, bot, eventBus, log, playersRepository }) => {
  const queueService = new QueueService({
    readyMs: TIME_READY,
    gameMs: DEFAULT_GAME_TIME,
    workSchedule: WORK_SCHEDULE,
  })
  const clock = new SystemClock()
  const notifier = new EventNotifier({ eventBus })
  const orchestrator = {
    scheduleLifecycle: () => {},
    scheduleFinish: () => {},
    cancelForMatch: () => {},
    cancelAll: () => {},
    handleMatchFinished: async () => {},
  }

  // Ретранслируем в чат любое уведомление usecase'ов (например, отмену матча из
  // CancelMatch), кроме служебных state_update — раньше сюда попадал только
  // анонс созданного матча, и отмена матча из мини-аппа проходила молча.
  notifier.onMessage(({ chatId, text, meta }) => {
    if (meta?.type === 'state_update' || !text) return
    const replyMarkup =
      meta?.type === 'match_created' && meta.match ? buildMatchCancelKeyboard(meta.match, ui) : undefined
    bot
      .sendMessage(chatId, text, replyMarkup ? { reply_markup: replyMarkup } : undefined)
      .catch((error) => log.error('Не удалось отправить уведомление о событии очереди', {
        chatId,
        message: error.message,
      }))
  })

  const registerSearch = new RegisterSearch({ repository: queueRepository, queueService, messages, clock })
  const cancelSearch = new CancelSearch({ repository: queueRepository, queueService, messages, clock })
  const addMatch = new AddMatch({
    chatId: queueChatId,
    repository: queueRepository,
    queueService,
    orchestrator,
    notifier,
    messages,
    clock,
  })
  const cancelMatch = new CancelMatch({
    chatId: queueChatId,
    repository: queueRepository,
    queueService,
    orchestrator,
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
  const claimPlayerIdentity = new ClaimPlayerIdentity({ queueRepository, playersRepository, logger: log })

  return {
    chatId: queueChatId,
    queueService,
    repository: queueRepository,
    notifier,
    clock,
    orchestrator,
    registerSearch,
    addMatch,
    directMatch,
    cancelSearch,
    cancelMatch,
    getQueue,
    getPlayed,
    claimPlayerIdentity,
    inlineMessageId: null,
  }
}

/**
 * Строит минимальные реализации pause/emerge-функций для backend-only режима.
 * Флаг admin-mode локален процессу, а поведение текущей головы сохраняется
 * в durable queue state и передаётся bot-процессу через state-update wakeup.
 */
export const buildLocalAdminState = ({ bot, messages, isDev = false, logger }) => {
  const pauseModeChats = new Set()
  const emergeStateByChat = new Map()

  const isPauseModeEnabled = (chatId) => pauseModeChats.has(String(chatId))
  const setPauseMode = (chatId, enabled) => {
    if (enabled) pauseModeChats.add(String(chatId))
    else pauseModeChats.delete(String(chatId))
  }

  const applyPauseMode = async ({ chatId, context }) => {
    let result
    try {
      result = await updateQueueState({
        repository: context.repository,
        logger: logger || { warn: () => {} },
        operation: 'backend_pause',
        mutate: (state) => {
          if (!state.queue.length) return { state, hasQueue: false, save: false }
          const now = context.clock.now()
          const current = state.queue[0]
          const elapsedMs = now.getTime() - current.startDate.getTime()
          const currentContinues =
            current.status === Match.statuses.playing && elapsedMs >= 5 * 60 * 1000
          state.queue.forEach((item, index) => {
            if (index === 0 && currentContinues) return
            item.status = Match.statuses.waiting
          })
          state.holdNextMatch = currentContinues
          return { state, hasQueue: true }
        },
      })
    } catch (err) {
      // Локальный флаг паузы не трогаем: состояние не изменено, повтор возможен
      if (err instanceof QueueStateConflictError) {
        return { hasQueue: false, conflict: true }
      }
      throw err
    }
    if (result.hasQueue) setPauseMode(chatId, true)
    if (result.hasQueue) {
      context.notifier.notify(context.chatId, '', { type: 'state_update' })
    }
    if (!isDev) {
      bot.sendMessage(chatId, messages.pauseModeEnabled({ action: 'none' })).catch(() => {})
    }
  }

  const resumeQueueAfterPause = async (context) => {
    if (!context) return { hasQueue: false }
    const now = context.clock.now()
    let result
    try {
      result = await updateQueueState({
        repository: context.repository,
        logger: logger || { warn: () => {} },
        operation: 'backend_resume_queue',
        mutate: (state) => {
          if (!state.queue.length) return { state, hasQueue: false, save: false }
          const nextMatch = state.queue[0]
          const isCurrentPlaying =
            nextMatch.status === Match.statuses.playing && now >= nextMatch.startDate
          if (isCurrentPlaying) {
            state.holdNextMatch = false
            return { state, hasQueue: true, currentMatchContinues: true, currentMatch: nextMatch }
          }
          nextMatch.status = Match.statuses.playing
          nextMatch.startDate = new Date(now.getTime() + context.queueService.readyMs)
          nextMatch.endDate = new Date(nextMatch.startDate.getTime() + context.queueService.gameMs)
          state.holdNextMatch = false
          context.queueService.recalculateWaiting(state)
          return { state, hasQueue: true, nextMatch }
        },
      })
    } catch (err) {
      // Локальный флаг паузы не трогаем: состояние не изменено, повтор возможен
      if (err instanceof QueueStateConflictError) {
        return { hasQueue: false, conflict: true }
      }
      throw err
    }
    if (result.hasQueue) setPauseMode(context.chatId, false)
    if (result.hasQueue) {
      context.notifier.notify(context.chatId, '', { type: 'state_update' })
    }
    // Bot-процесс поставит таймеры, получив state_update через Redis
    return result
  }

  // В backend-only режиме emerge-состояние не отслеживается между процессами
  const resumeEmergeAfterContinue = async (_deps) => ({ handled: false })

  const handleEmerge = async ({ chatId, context, userId }) => {
    if (isDev) {
      await applyPauseMode({ chatId, context })
      return
    }
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
    methods: ['GET', 'POST', 'DELETE', 'PATCH', 'OPTIONS'],
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
      ui: resolvedUi,
      bot,
      eventBus,
      log,
      playersRepository,
    })
    resolvedGetContext = (_chatId) => backendContext

    const adminState = buildLocalAdminState({
      bot,
      messages: resolvedMessages,
      isDev: process.env.NODE_ENV !== 'production',
      logger: log,
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
    return toPublicState({
      state,
      paused: resolvedIsPauseModeEnabled ? resolvedIsPauseModeEnabled(queueChatId) : false,
      emergeActive: resolvedEmergeStateByChat
        ? resolvedEmergeStateByChat.has(String(queueChatId))
        : false,
      serverTime: resolvedContext.clock.now().toISOString(),
      pendingInvites: invitesStore ? await invitesStore.getAll() : [],
    })
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
