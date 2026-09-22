import { verifyInitData } from './auth.js'
import {
  buildSearchInlineKeyboard,
  buildDirectInviteKeyboard,
  buildDirectInviteInitiatorKeyboard,
  buildDirectInviteRecipientKeyboard,
  buildMatchCancelKeyboard,
  buildConfirmRegistrationKeyboard,
} from '#interfaces/telegram/keyboards.js'
import { QueueState } from '#domain'
import { recoverTimers } from '#infrastructure/timers/recoverTimers.js'
import { updateQueueState } from '#application/usecases/queueStateCas.js'
import {
  sendDirectInviteNotification,
  notifyDirectInviteInitiator,
} from '#interfaces/telegram/directInviteNotification.js'
import { createTestIdentityHelper } from '#application/usecases/createTestIdentityHelper.js'
import { isSyntheticFormerUsername, toPublicPlayer, toPublicState } from './publicDtos.js'

/**
 * Регистрирует все REST-маршруты webapp-интерфейса.
 *
 * @param {import('fastify').FastifyInstance} app
 * @param {object} deps
 */
export const registerRoutes = async (app, deps) => {
  const {
    bot,
    getContext,
    queueChatId,
    sseManager,
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
  } = deps

  const context = getContext(queueChatId)
  const legacyTestContext = !context?.claimPlayerIdentity && !context?.testIdentityActivation

  const buildStatePayload = async () => {
    // getVersioned даёт revision — монотонный маркер порядка снимков, нужный
    // клиенту, чтобы не откатить UI устаревшим payload'ом, пришедшим позже
    // свежего (см. toPublicState).
    const { state, revision } = typeof context.repository.getVersioned === 'function'
      ? await context.repository.getVersioned()
      : { state: await context.repository.get(), revision: undefined }
    return toPublicState({
      state,
      paused: isPauseModeEnabled(queueChatId),
      emergeActive: emergeStateByChat.has(String(queueChatId)),
      serverTime: context.clock.now().toISOString(),
      revision,
      pendingInvites: await invitesStore.getAll(),
    })
  }

  // --- preHandlers ---

  const isDev = process.env.NODE_ENV !== 'production'
  // Общий dev-fallback identity для auth() (без initData) и для GET /api/events
  // (без initData в query) — единственный источник истины, чтобы оба пути
  // не разъехались по userId и не сломали ban-проверку в dev-режиме.
  const DEV_USER_ID = 123456
  const DEV_USERNAME = '@dev_user'
  // Владелец METRICS_CHAT_ID (в личном чате с ботом chat_id совпадает с его
  // userId) — доверенный владелец бота, у него безусловный доступ к мини-аппу
  // независимо от прохождения подтверждения регистрации (см. isUserVerified).
  const OWNER_USER_ID = process.env.METRICS_CHAT_ID || null
  const activateTestIdentity = typeof context.testIdentityActivation === 'function'
    ? context.testIdentityActivation
    : isDev && context.claimPlayerIdentity
      ? createTestIdentityHelper({ claimPlayerIdentity: context.claimPlayerIdentity })
      : null

  const notifyChat = isDev
    ? async () => null
    : async (text, replyMarkup = undefined) => {
        try {
          return await bot.sendMessage(queueChatId, text, replyMarkup ? { reply_markup: replyMarkup } : undefined)
        } catch (err) {
          log.error('Не удалось уведомить чат из webapp', { message: err.message })
          return null
        }
      }

  // Личное уведомление игроку в ЛС через бота — используется там, где вторая
  // сторона прямого приглашения должна узнать об отмене/отказе, но общий чат
  // об этом знать не должен (см. /api/direct/cancel и /api/direct/decline).
  const notifyPlayerDirect = isDev
    ? async () => null
    : async (userId, text) => {
        if (userId == null) return null
        try {
          return await bot.sendMessage(userId, text)
        } catch (err) {
          log.warn('Не удалось отправить личное уведомление игроку', { message: err.message })
          return null
        }
      }

  // Ошибки Telegram вида "сообщение уже не то" или "уже не менялось" — не
  // повод для log.error: анонс мог быть уже тронут другим процессом/каналом.
  const isStaleTelegramMessageError = (err) =>
    /message is not modified|message to (delete|edit) not found|message can't be deleted/i.test(
      err?.response?.body?.description || err?.message || ''
    )

  // Более узкая проверка: сообщения точно больше не существует. "Can't be
  // deleted" сюда намеренно не входит (в отличие от isStaleTelegramMessageError
  // выше) — эта ошибка может значить и "уже удалено", и "нет прав на
  // удаление", а во втором случае сообщение всё ещё существует и
  // editMessage* по нему всё ещё может сработать.
  const isMessageGoneError = (err) =>
    /message to delete not found/i.test(err?.response?.body?.description || err?.message || '')

  const logAnnouncementError = (message, err) => {
    log[isStaleTelegramMessageError(err) ? 'warn' : 'error'](message, { message: err.message })
  }

  // Анонс "хочет поиграть", созданный через мини-апп: помним, каким сообщением
  // он был опубликован, чтобы при отмене/принятии поиска убрать именно его,
  // а не плодить новые сообщения поверх старого. Живёт только в памяти этого
  // процесса — поиск, начатый через бот-команду или inline, сюда не попадает,
  // как и любой анонс, переживший рестарт процесса. Запись снимается на любом
  // пути, которым игрок покидает поиск (отмена, принятие своего поиска, а
  // также согласие/отказ/отмена прямого приглашения — оно тоже переводит
  // игрока в состояние поиска).
  const searchAnnouncements = new Map()

  const takeSearchAnnouncement = (player) => {
    const announcement = searchAnnouncements.get(player)
    searchAnnouncements.delete(player)
    return announcement
  }

  // Тихо убирает анонс без текстового фоллбека — для путей, где игрок покидает
  // поиск не по собственной отмене (принят/отклонён/забанен), и где отдельное
  // сообщение об этом событии уже отправляется своим текстом.
  const discardSearchAnnouncement = async (player) => {
    const announcement = takeSearchAnnouncement(player)
    if (!announcement) return
    try {
      await bot.deleteMessage(announcement.chatId, announcement.messageId)
    } catch (err) {
      logAnnouncementError('Не удалось удалить устаревший анонс поиска', err)
    }
  }

  // Инициаторы приглашений, которые AddMatch погасил как побочный эффект
  // создания ЧУЖОГО матча (см. AddMatch.discardStaleInvites) — их тоже
  // тихо снимаем, если у их поиска был свой анонс в чате. AddMatch про эти
  // анонсы не знает (они живут только в памяти этого процесса), поэтому
  // чистит только состояние очереди — сообщение остаётся забота роутера.
  const discardOrphanedSearchAnnouncements = (usernames) => {
    for (const username of usernames || []) discardSearchAnnouncement(username)
  }

  const removeSearchAnnouncement = async (player) => {
    const announcement = takeSearchAnnouncement(player)
    if (!announcement) {
      // Анонс не найден (поиск начат вне мини-аппа, либо запись потеряна
      // рестартом процесса) — но сам запрос на отмену всё равно пришёл из
      // мини-аппа (это единственный клиент DELETE /api/search), поэтому
      // текстовый "передумал" в общий чат отсюда не летит ни при каких
      // обстоятельствах: это как раз то сообщение, которого требование
      // альфа-теста просит не показывать.
      return
    }
    try {
      await bot.deleteMessage(announcement.chatId, announcement.messageId)
      return
    } catch (err) {
      logAnnouncementError('Не удалось удалить анонс поиска из webapp', err)
      // Сообщение уже не существует (кто-то удалил его раньше нас, или оно и
      // так пропало) — вторая попытка тронуть тот же message_id закончится
      // той же ошибкой, снимать клавиатуру не с чего.
      if (isMessageGoneError(err)) return
    }
    // Анонс создан через мини-апп — отмена поиска из мини-аппа должна
    // оставаться тихой, даже если удалить сообщение не вышло (например, у
    // бота нет прав на удаление в этом чате). В отличие от анонса неизвестного
    // происхождения (см. ветку выше), про текст "передумал" здесь речи быть
    // не должно — вместо этого просто снимаем клавиатуру, чтобы неактуальная
    // кнопка "Сыграть с ним" не осталась активной поверх устаревшего анонса.
    try {
      await bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        { chat_id: announcement.chatId, message_id: announcement.messageId }
      )
    } catch (editErr) {
      logAnnouncementError('Не удалось снять клавиатуру анонса поиска после неудачного удаления', editErr)
    }
  }

  const resolveSearchAnnouncement = async (searcher, accepter, match) => {
    const announcement = takeSearchAnnouncement(searcher)
    if (!announcement) return
    try {
      await bot.editMessageText(messages.searchAccepted(accepter), {
        chat_id: announcement.chatId,
        message_id: announcement.messageId,
        reply_markup: (match && buildMatchCancelKeyboard(match, ui)) || { inline_keyboard: [] },
      })
    } catch (err) {
      logAnnouncementError('Не удалось обновить анонс поиска после принятия приглашения', err)
    }
  }

  const isUserBanned = async (user, username) => {
    if (typeof playersRepository.isBanned === 'function' && user?.id != null) {
      return playersRepository.isBanned(user.id)
    }
    if (typeof playersRepository.findByUserId === 'function' && user?.id != null) {
      const player = await playersRepository.findByUserId(user.id)
      return player?.banned === true
    }
    if (typeof playersRepository.findOne === 'function' && username) {
      const player = await playersRepository.findOne(username)
      return player?.banned === true
    }
    return false
  }

  const isUserVerified = async (user, username) => {
    if (OWNER_USER_ID != null && user?.id != null && String(user.id) === String(OWNER_USER_ID)) {
      return true
    }
    if (typeof playersRepository.isVerified === 'function' && user?.id != null) {
      return playersRepository.isVerified(user.id)
    }
    if (typeof playersRepository.findByUserId === 'function' && user?.id != null) {
      const player = await playersRepository.findByUserId(user.id)
      return player?.verified === true
    }
    if (typeof playersRepository.findOne === 'function' && username) {
      const player = await playersRepository.findOne(username)
      return player?.verified === true
    }
    return false
  }

  const isUsernameBanned = async (username) => {
    if (!username || typeof playersRepository.findOne !== 'function') return false
    const player = await playersRepository.findOne(username)
    return player?.banned === true
  }

  const isInviteParticipantAuthorized = async (invite, actor, actorUserId, role) => {
    const identity = role === 'initiator' ? invite?.playerIdentity : invite?.opponentIdentity
    return Boolean(identity?.username === actor
      && identity.userId != null
      && String(identity.userId) === String(actorUserId))
  }

  const isInviteInitiatorBanned = async (invite) => {
    if (invite?.playerIdentity?.userId == null) return true
    if (typeof playersRepository.findOne === 'function') {
      const current = await playersRepository.findOne(invite.player)
      if (current) return current.banned === true
    }
    return isUserBanned({ id: invite.playerIdentity.userId }, invite.player)
  }

  const auth = async (req, reply) => {
    const initData = req.headers['x-telegram-init-data']

    // В dev-режиме пропускаем без initData (для тестирования через браузер)
    if (isDev && !initData) {
      req.tgUser = { id: DEV_USER_ID, username: 'dev_user', firstName: 'Dev', lastName: '' }
      req.player = DEV_USERNAME
    } else {
      const result = verifyInitData(initData, process.env.TG_BOT_API_TOKEN)
      if (!result.ok) return reply.code(401).send({ error: result.reason })
      if (!result.user.username) return reply.code(400).send({ error: 'username_required' })
      req.tgUser = result.user
      req.player = `@${result.user.username}`
    }

    try {
      if (context.claimPlayerIdentity) {
        req.identityToken = await context.claimPlayerIdentity.execute({
          username: req.player,
          userId: req.tgUser.id,
          firstName: req.tgUser.firstName,
          lastName: req.tgUser.lastName,
        })
      } else if (activateTestIdentity) {
        req.identityToken = await activateTestIdentity({
          username: req.player,
          userId: req.tgUser.id,
        })
      } else {
        throw new Error('identity claim context unavailable')
      }
      if (req.identityToken?.transitions?.length) {
        const cleanupSucceeded = await cleanupPlayerIdentity({ identities: req.identityToken.transitions })
        if (!cleanupSucceeded) {
          return reply.code(503).send({ error: 'identity_cleanup_unavailable' })
        }
      }
    } catch (err) {
      log.error(legacyTestContext
        ? 'Не удалось зарегистрировать игрока из webapp'
        : 'Не удалось подтвердить identity игрока из webapp', {
        username: req.player,
        message: err.message,
      })
      if (err?.transitions?.length) {
        const cleanupSucceeded = await cleanupPlayerIdentity({ identities: err.transitions })
        if (!cleanupSucceeded) {
          return reply.code(503).send({ error: 'identity_cleanup_unavailable' })
        }
      }
      if (err.reason === 'player_banned') {
        return reply.code(403).send({ error: 'player_banned' })
      }
      return reply.code(503).send({ error: legacyTestContext ? 'player_registration_failed' : 'player_identity_unavailable' })
    }

    // Регистрация намеренно выполняется до этой проверки: вход не снимает бан.
    try {
      if (await isUserBanned(req.tgUser, req.player)) {
        return reply.code(403).send({ error: 'player_banned' })
      }
    } catch (err) {
      log.error('Не удалось проверить бан игрока', {
        username: req.player,
        message: err.message,
      })
      return reply.code(503).send({ error: 'player_status_unavailable' })
    }
  }

  const requireAdmin = async (req, reply) => {
    try {
      const member = await bot.getChatMember(queueChatId, req.tgUser.id)
      if (!['administrator', 'creator'].includes(member?.status)) {
        return reply.code(403).send({ error: 'admin_required' })
      }
    } catch {
      return reply.code(403).send({ error: 'admin_check_failed' })
    }
  }

  // Гейт доступа к геймплейным/админским действиям мини-аппа: игрок должен
  // один раз подтвердить себя кнопкой в общем чате (см. POST /api/register и
  // confirm_player-callback в bot.js). Не применяется к самому /api/register
  // (иначе новый игрок никогда не смог бы запросить подтверждение) и к
  // публичным/безобидным GET-эндпоинтам — см. комментарии у роутов.
  const requireVerified = async (req, reply) => {
    try {
      if (!(await isUserVerified(req.tgUser, req.player))) {
        return reply.code(403).send({ error: 'not_verified' })
      }
    } catch (err) {
      log.error('Не удалось проверить подтверждение регистрации игрока', {
        username: req.player,
        message: err.message,
      })
      return reply.code(503).send({ error: 'player_status_unavailable' })
    }
  }

  // Администраторы общего чата — их нельзя забанить через мини-апп (см.
  // DELETE/PATCH /api/players) и они помечаются бейджем в управлении.
  // Единый запрос списком вместо getChatMember на каждого игрока, да ещё и
  // с коротким TTL-кешем: GET /api/players дергается без авторизации на
  // каждый заход в мини-апп, и без кеша это была бы прямая дыра для того,
  // чтобы выжигать лимит Telegram API на весь процесс бота.
  // Кешируется именно промис (не результат) — иначе холодный кеш даёт N
  // параллельных вызовов Telegram на N одновременных запросов. Неуспех тоже
  // кешируется, но на пару секунд: иначе недоступность Telegram открывает
  // ровно тот вектор нагрузки, от которого кеш должен защищать.
  // Ошибка Telegram (или недоступность метода в тестовом моке) намеренно
  // fail-open — пустой Set: бейдж админа просто не покажется, а бан не
  // заблокируется. Это осознанный компромисс — недоступность Telegram не
  // должна блокировать легитимные действия админа.
  const CHAT_ADMIN_IDS_TTL_MS = 30_000
  const CHAT_ADMIN_IDS_FAILURE_TTL_MS = 5_000
  let chatAdminIdsCache = null // { promise: Promise<Set<string>>, expiresAt: number }
  const getChatAdminIds = ({ fresh = false } = {}) => {
    if (!fresh && chatAdminIdsCache && chatAdminIdsCache.expiresAt > Date.now()) {
      return chatAdminIdsCache.promise
    }
    if (typeof bot.getChatAdministrators !== 'function') return Promise.resolve(new Set())
    const promise = bot.getChatAdministrators(queueChatId)
      .then((admins) => new Set(
        (admins || [])
          .filter((member) => member?.user?.id != null)
          .map((member) => String(member.user.id))
      ))
      .catch((err) => {
        log.warn('Не удалось получить список администраторов чата', { message: err.message })
        // Затираем кеш, только если он всё ещё наш: за время запроса его мог
        // успеть перезаписать более свежий вызов (например, fresh: true из
        // ban-хендлера) — не хотим откатывать уже успешный результат.
        if (chatAdminIdsCache?.promise === promise) {
          chatAdminIdsCache = {
            promise: Promise.resolve(new Set()),
            expiresAt: Date.now() + CHAT_ADMIN_IDS_FAILURE_TTL_MS,
          }
        }
        return new Set()
      })
    chatAdminIdsCache = { promise, expiresAt: Date.now() + CHAT_ADMIN_IDS_TTL_MS }
    return promise
  }

  // ==================== ROUTES ====================

  // GET /api/state — текущее состояние очереди (без авторизации)
  app.get('/api/state', async () => {
    return buildStatePayload()
  })

  // GET /api/admin/check — проверить права администратора
  app.get('/api/admin/check', { preHandler: [auth] }, async (req) => {
    try {
      const member = await bot.getChatMember(queueChatId, req.tgUser.id)
      return { isAdmin: ['administrator', 'creator'].includes(member?.status) }
    } catch {
      return { isAdmin: false }
    }
  })

  // GET /api/events — SSE поток
  app.get('/api/events', async (req, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.setHeader('X-Accel-Buffering', 'no')
    reply.hijack()

    // initData передаётся строкой запроса, а не заголовком: EventSource не
    // умеет ставить кастомные HTTP-заголовки. Нужен он здесь только чтобы
    // привязать SSE-соединение к userId для точечного оповещения о бане
    // (см. sseManager.notifyUser ниже) — identity этим не claim'ится, её
    // по-прежнему подтверждает auth() на каждом мутирующем запросе.
    const initData = req.query?.initData
    let userId = null
    let username = null
    if (initData) {
      const result = verifyInitData(initData, process.env.TG_BOT_API_TOKEN)
      if (result.ok) {
        userId = result.user.id
        username = result.user.username ? `@${result.user.username}` : null
      } else {
        log.warn('Не удалось проверить initData при подключении к SSE', { reason: result.reason })
      }
    } else if (isDev) {
      userId = DEV_USER_ID
      username = DEV_USERNAME
    }

    // Регистрируем соединение до чтения состояния: бан, наступивший позже
    // (см. sseManager.notifyUser в ban-хендлерах), поймает этот listener;
    // бан, уже случившийся раньше, поймает проверка ниже. Порядок исключает
    // окно, в котором бан произошёл бы "между" и не долетел ни одним путём.
    sseManager.addClient(reply.raw, userId)

    // Сразу отправить текущее состояние
    const payload = await buildStatePayload()
    reply.raw.write(`event: state_update\ndata: ${JSON.stringify(payload)}\n\n`)

    // Игрок мог быть забанен ещё до открытия (пере)подключения — например,
    // переоткрыл мини-апп после бана. Сообщаем тем же каналом сразу, не
    // дожидаясь его первого мутирующего запроса. Через sseManager.notifyUser,
    // а не прямой записью в reply.raw — тот же путь, что и у ban-хендлеров,
    // без второй копии SSE wire-формата.
    if (userId != null) {
      try {
        if (await isUserBanned({ id: userId }, username)) {
          sseManager.notifyUser(userId, 'player_banned', { reason: 'player_banned' })
        }
      } catch (err) {
        log.warn('Не удалось проверить бан при подключении к SSE', { message: err.message })
      }
      // Симметрично бану: подтверждение регистрации тоже могло произойти,
      // пока это конкретное SSE-соединение было разорвано (типичный путь
      // этой фичи — уйти из мини-аппа в чат и вернуться, а Redis pub/sub
      // ничего не буферизует, так что push в момент разрыва теряется
      // безвозвратно). Без этой проверки при реконнекте уже подтверждённый
      // игрок навсегда застревал бы на логин-экране до полного перезапуска
      // мини-аппа.
      try {
        if (await isUserVerified({ id: userId }, username)) {
          sseManager.notifyUser(userId, 'player_verified', { verified: true })
        }
      } catch (err) {
        log.warn('Не удалось проверить подтверждение регистрации при подключении к SSE', { message: err.message })
      }
    }
  })

  // GET /api/players — список известных игроков
  app.get('/api/players', async () => {
    const players = await playersRepository.findAll()
    const adminIds = await getChatAdminIds()
    return {
      players: players
        .filter((player) => !isSyntheticFormerUsername(player?.username))
        .map((player) => ({
          ...toPublicPlayer(player, { ownerUserId: OWNER_USER_ID }),
          isAdmin: player?.userId != null && adminIds.has(String(player.userId)),
        })),
    }
  })

  // GET /api/players/:username/avatar — редирект на аватар игрока
  app.get('/api/players/:username/avatar', async (req, reply) => {
    const atUsername = `@${req.params.username}`
    const player = await playersRepository.findOne(atUsername)
    if (!player?.userId) return reply.code(404).send()

    try {
      const photos = await bot.getUserProfilePhotos(player.userId, { limit: 1 })
      if (!photos.total_count) return reply.code(404).send()

      const fileId = photos.photos[0][0].file_id
      const fileLink = await bot.getFileLink(fileId)
      return reply.redirect(302, fileLink)
    } catch (err) {
      log.warn('Не удалось получить аватар', { username: atUsername, message: err.message })
      return reply.code(404).send()
    }
  })

  const setPlayerBanned = async (username, banned) => {
    if (typeof playersRepository.setBanned === 'function') {
      return playersRepository.setBanned(username, banned)
    }
    if (banned && typeof playersRepository.banOne === 'function') {
      return playersRepository.banOne(username)
    }
    if (!banned && typeof playersRepository.unbanOne === 'function') {
      return playersRepository.unbanOne(username)
    }
    // Совместимость со старым внешним репозиторием. Штатные repositories
    // реализуют DELETE как бан и не попадают в этот fallback.
    if (banned && typeof playersRepository.deleteOne === 'function') {
      return playersRepository.deleteOne(username)
    }
    return false
  }

  const setQueueBanFence = async (userId, banned) => {
    if (userId == null) return true
    if (typeof context.repository?.getVersioned !== 'function'
      || typeof context.repository?.saveIfRevision !== 'function') return true
    try {
      await updateQueueState({
        repository: context.repository,
        logger: log,
        operation: banned ? 'ban_identity_fence' : 'unban_identity_fence',
        mutate: (state) => {
          state.setBannedIdentity(userId, banned)
          return { state }
        },
      })
      return true
    } catch (error) {
      log.error('Не удалось обновить ban identity fence', { userId, message: error.message })
      return false
    }
  }

  const getPlayerAliasesForIdentity = async (player, fallbackUsername = undefined) => {
    if (player?.userId != null && typeof playersRepository.getAliasesByUserId === 'function') {
      const aliases = await playersRepository.getAliasesByUserId(player.userId)
      return [...new Set([fallbackUsername, ...(aliases || [])].filter(Boolean))]
    }
    if (player?.usernames?.length) {
      return [...new Set([fallbackUsername, player.username, ...player.usernames].filter(Boolean))]
    }
    if (fallbackUsername && typeof playersRepository.getAliases === 'function') {
      const aliases = await playersRepository.getAliases(fallbackUsername)
      return [...new Set([fallbackUsername, ...(aliases || [])])]
    }
    return [fallbackUsername || player?.username].filter(Boolean)
  }

  const removePlayerIdentityFromQueue = async ({ userId, identities = [] }) => {
    const matchesIdentity = (state, player) => {
      const storedIdentity = state.searchingIdentities?.[player]
      if (identities.length > 0) {
        return identities.some((identity) =>
          storedIdentity?.username === identity?.username
          && String(storedIdentity?.userId) === String(identity?.userId)
          && Number(storedIdentity?.generation) === Number(identity?.generation)
        )
      }
      return userId != null && storedIdentity?.userId != null
        && String(storedIdentity.userId) === String(userId)
    }
    // Уже созданные матчи намеренно не удаляются: они завершаются по обычному
    // lifecycle. Запрещаем только новые матчи и убираем игрока из поиска.
    let queueChanged = false
    // mutate может выполниться повторно при CAS-конфликте — список набираем
    // заново на каждой попытке, а сами Telegram-вызовы делаем уже после того,
    // как состояние гарантированно сохранено (сайд-эффекты внутри retryable
    // mutate недопустимы).
    let removedPlayers = []
    if (typeof context.repository.getVersioned === 'function'
      && typeof context.repository.saveIfRevision === 'function') {
      await updateQueueState({
        repository: context.repository,
        logger: log,
        operation: 'ban_remove_search',
        mutate: (state) => {
          removedPlayers = []
          const before = state.searching.length
          for (const player of [...state.searching]) {
            if (matchesIdentity(state, player)) {
              state.removeStaleSearching(player, state.searchingIdentities[player])
              removedPlayers.push(player)
            }
          }
          if (state.searching.length === before) return { state, save: false, changed: false }
          return { state, changed: true }
        },
      }).then((result) => { queueChanged = result.changed === true })
    } else {
      const state = await context.repository.get()
      const before = state.searching.length
      removedPlayers = state.searching.filter((player) => matchesIdentity(state, player))
      state.searching = state.searching.filter((player) => !matchesIdentity(state, player))
      queueChanged = state.searching.length !== before
      if (queueChanged) await context.repository.save(state)
    }
    // Анонс "хочет поиграть" забаненного/переименованного игрока больше не
    // актуален — убираем его так же тихо, как и сам поиск. Не ждём Telegram:
    // это вызывается и из preHandler'а auth при смене username, где лишняя
    // задержка ответа особенно заметна.
    for (const player of removedPlayers) {
      discardSearchAnnouncement(player)
    }
    return queueChanged
  }

  const removePlayerIdentityInvites = async ({ userId, identities = [] }) => {
    if (typeof invitesStore.deleteByParticipant === 'function') {
      return Boolean(await invitesStore.deleteByParticipant({
        userIds: identities.length > 0 || userId == null ? [] : [userId],
        identities,
      }))
    }
    if (typeof invitesStore.getAll !== 'function' || typeof invitesStore.deleteById !== 'function') {
      return false
    }
    const invites = await invitesStore.getAll()
    const affected = invites.filter((invite) => {
      const tokenMatches = identities.some((identity) =>
        [invite.playerIdentity, invite.opponentIdentity].some((participant) =>
          participant?.username === identity?.username
          && String(participant?.userId) === String(identity?.userId)
          && Number(participant?.generation) === Number(identity?.generation)
        )
      )
      if (identities.length > 0) return tokenMatches
      const playerMatches = userId != null
        && String(invite.playerIdentity?.userId) === String(userId)
      const opponentMatches = userId != null
        && String(invite.opponentIdentity?.userId) === String(userId)
      return playerMatches || opponentMatches
    })
    for (const invite of affected) await invitesStore.deleteById(invite.inviteId)
    return affected.length > 0
  }

  const cleanupPlayerIdentity = async ({ userId, usernames = [], identities = [] }) => {
    try {
      const queueChanged = await removePlayerIdentityFromQueue({ userId, identities })
      const invitesChanged = await removePlayerIdentityInvites({ userId, identities })
      if (queueChanged || invitesChanged) {
        sseManager.broadcast('state_update', await buildStatePayload())
      }
    } catch (err) {
      log.error('Не удалось очистить состояние заблокированного игрока', {
        userId,
        usernames,
        message: err.message,
      })
      return false
    }
    return true
  }

  // DELETE /api/players/:username — заблокировать игрока (только admin)
  app.delete('/api/players/:username', { preHandler: [auth, requireVerified, requireAdmin] }, async (req, reply) => {
    const atUsername = `@${req.params.username}`
    // Защита привязана к userId из записи игрока: если репозиторий не
    // умеет findOne или у записи ещё нет userId (игрок ни разу не
    // авторизовался через мини-апп), проверить админство невозможно и она
    // молча пропускается — это тот же repository-capability допущение, на
    // котором и так держится весь файл (см. getPlayerAliasesForIdentity).
    const player = typeof playersRepository.findOne === 'function'
      ? await playersRepository.findOne(atUsername)
      : null
    // fresh: true — бан редкая операция под requireAdmin, а не публичный
    // листинг, здесь важнее не забанить админа по устаревшему кешу, чем
    // сэкономить один вызов Telegram.
    if (player?.userId != null && (await getChatAdminIds({ fresh: true })).has(String(player.userId))) {
      return reply.code(403).send({ error: 'cannot_ban_admin' })
    }
    const aliases = await getPlayerAliasesForIdentity(player, atUsername)
    // Снимаем до setPlayerBanned: InMemoryPlayersRepository.findOne отдаёт
    // живую ссылку на запись, которую setBanned мутирует на месте — если
    // прочитать player.banned после этого вызова, там уже будет true.
    const wasAlreadyBanned = player?.banned === true
    const banned = await setPlayerBanned(atUsername, true)
    if (!banned) return reply.code(404).send({ error: 'player_not_found' })
    if (!await setQueueBanFence(player?.userId, true)) {
      return reply.code(503).send({ error: 'ban_fence_unavailable' })
    }
    const cleanupSucceeded = await cleanupPlayerIdentity({
      userId: player?.userId,
      usernames: aliases,
    })
    if (!cleanupSucceeded) return reply.code(503).send({ error: 'ban_cleanup_unavailable' })
    // Не ждём Telegram, как и остальные уведомления в этом файле — ответ
    // админу не должен зависеть от round-trip до чата с игроком.
    if (!wasAlreadyBanned) {
      notifyPlayerDirect(player?.userId, messages.playerBanned())
      // Если у игрока в этот момент открыт мини-апп — оповещаем его тем же
      // тиком через SSE, не дожидаясь следующего запроса к API.
      sseManager.notifyUser(player?.userId, 'player_banned', { reason: 'player_banned' })
    }
    return { ok: true }
  })

  // PATCH /api/players/:username — изменить статус бана (только admin)
  app.patch('/api/players/:username', { preHandler: [auth, requireVerified, requireAdmin] }, async (req, reply) => {
    const { banned } = req.body || {}
    if (typeof banned !== 'boolean') {
      return reply.code(400).send({ error: 'banned_boolean_required' })
    }
    const atUsername = `@${req.params.username}`
    const player = typeof playersRepository.findOne === 'function'
      ? await playersRepository.findOne(atUsername)
      : null
    // fresh: true — см. пояснение в DELETE-хендлере выше.
    if (banned && player?.userId != null
      && (await getChatAdminIds({ fresh: true })).has(String(player.userId))) {
      return reply.code(403).send({ error: 'cannot_ban_admin' })
    }
    // Снимаем до setPlayerBanned — см. пояснение в DELETE-хендлере выше
    // (InMemoryPlayersRepository мутирует запись на месте).
    const wasAlreadyBanned = player?.banned === true
    const updated = await setPlayerBanned(atUsername, banned)
    if (!updated) return reply.code(404).send({ error: 'player_not_found' })
    if (!await setQueueBanFence(player?.userId, banned)) {
      return reply.code(503).send({ error: 'ban_fence_unavailable' })
    }
    if (banned) {
      const aliases = await getPlayerAliasesForIdentity(player, atUsername)
      const cleanupSucceeded = await cleanupPlayerIdentity({
        userId: player?.userId,
        usernames: aliases,
      })
      if (!cleanupSucceeded) return reply.code(503).send({ error: 'ban_cleanup_unavailable' })
      // Не ждём Telegram, как и остальные уведомления в этом файле; и не
      // дублируем сообщение, если игрок уже был забанен раньше.
      if (!wasAlreadyBanned) {
        notifyPlayerDirect(player?.userId, messages.playerBanned())
        // Если у игрока в этот момент открыт мини-апп — оповещаем его тем же
        // тиком через SSE, не дожидаясь следующего запроса к API.
        sseManager.notifyUser(player?.userId, 'player_banned', { reason: 'player_banned' })
      }
    } else if (wasAlreadyBanned) {
      // Симметрично бану: уведомляем о разбане, только если игрок
      // действительно был забанен до этого запроса. SSE-пуш здесь намеренно
      // не шлём — banState.isBanned на клиенте не сбрасывается назад в
      // false, а значит закрывающий отсчёт (см. App.vue) к этому моменту
      // либо уже отработал и мини-апп закрыт, либо вот-вот отработает;
      // "отменять" его нечем и незачем.
      notifyPlayerDirect(player?.userId, messages.playerUnbanned())
    }
    return { ok: true, banned }
  })

  // Когда игрок в последний раз запрашивал подтверждение регистрации —
  // антиспам-throttle для POST /api/register, аналогично searchAnnouncements
  // выше: живёт только в памяти этого процесса, при рестарте просто сбрасывается.
  const registrationRequestSentAt = new Map()
  const REGISTRATION_COOLDOWN_MS = 30_000

  // POST /api/register — запросить подтверждение доступа к мини-аппу: шлёт в
  // общий чат сообщение с кнопкой, нажать которую может только сам игрок (см.
  // confirm_player-callback в bot.js). Намеренно preHandler только [auth] —
  // без requireVerified, иначе новый игрок никогда не смог бы запросить
  // подтверждение в первый раз.
  app.post('/api/register', { preHandler: [auth] }, async (req, reply) => {
    if (await isUserVerified(req.tgUser, req.player)) {
      return { ok: true, alreadyVerified: true }
    }
    if (isDev) {
      // В dev-режиме нет реального сообщения с кнопкой — некому нажимать.
      // confirm_player-callback (bot.js) для dev-туннеля недостижим, а
      // mock-режим уже решает это через /api/dev/seed — здесь закрываем
      // прямой dev-тоннель без mock, иначе он навсегда застревал бы на
      // логин-экране. Проверяется раньше членства в чате и cooldown — оба
      // требуют реального bot/чата, которых в dev может не быть вовсе.
      // alreadyVerified: true — LoginScreen снимает экран сразу по этому же
      // полю, которым уже обрабатывает потерянный SSE-пуш.
      if (typeof playersRepository.setVerified === 'function') {
        await playersRepository.setVerified(req.player, true)
      }
      return { ok: true, alreadyVerified: true }
    }
    // Дешёвая in-memory проверка раньше похода в Telegram API: не тратим
    // getChatMember (общий rate limit бота) на повторные нажатия в пределах
    // cooldown — они и так не приведут к отправке.
    const key = String(req.tgUser.id)
    const lastSentAt = registrationRequestSentAt.get(key)
    if (lastSentAt != null && Date.now() - lastSentAt < REGISTRATION_COOLDOWN_MS) {
      return { ok: true, alreadyVerified: false, cooldown: true }
    }
    // Без этой проверки любой, кто когда-либо открыл диалог с ботом (initData
    // не требует членства в общем чате), мог бы дёргать этот эндпоинт и
    // засыпать чат сообщениями с живой кнопкой — same getChatMember, что и в
    // requireAdmin выше.
    try {
      const member = await bot.getChatMember(queueChatId, req.tgUser.id)
      if (!member || ['left', 'kicked'].includes(member.status)) {
        return reply.code(403).send({ error: 'not_chat_member' })
      }
    } catch (err) {
      log.error('Не удалось проверить членство в чате для запроса регистрации', {
        username: req.player,
        message: err.message,
      })
      return reply.code(503).send({ error: 'chat_membership_check_failed' })
    }
    const keyboard = buildConfirmRegistrationKeyboard(req.tgUser.id, ui)
    const sent = await notifyChat(messages.registrationRequest({ player: req.player }), keyboard)
    if (!sent) return reply.code(503).send({ error: 'registration_request_failed' })
    registrationRequestSentAt.set(key, Date.now())
    return { ok: true, alreadyVerified: false, cooldown: false }
  })

  // POST /api/search — встать в поиск
  app.post('/api/search', { preHandler: [auth, requireVerified] }, async (req) => {
    const result = await context.registerSearch.execute(req.player, req.identityToken)
    sseManager.broadcast('state_update', await buildStatePayload())
    if (result.status === 'added') {
      const sent = await notifyChat(messages.searchAdded(req.player), buildSearchInlineKeyboard(req.player, ui))
      if (sent?.message_id != null) {
        searchAnnouncements.set(req.player, { chatId: queueChatId, messageId: sent.message_id })
      }
    }
    return { ok: true, status: result.status }
  })

  // DELETE /api/search — отменить поиск
  app.delete('/api/search', { preHandler: [auth, requireVerified] }, async (req) => {
    // Инициатор прямого приглашения тоже числится в общем поиске на бэкенде
    // (см. CreateDirectMatch) — но для него нет анонса "хочет поиграть" в
    // чате, поэтому дефолтный текстовый фоллбек ниже ошибочно объявит об
    // отмене приглашение, которое никто не принимал. Ловим этот случай явно
    // и гасим приглашение так же тихо, как /api/direct/cancel, вместо того
    // чтобы полагаться на клиент, который всегда покажет правильную кнопку.
    const outgoingInvite = typeof invitesStore.getByPlayer === 'function'
      ? await invitesStore.getByPlayer(req.player)
      : null
    let consumedInvite = null
    if (outgoingInvite) {
      try {
        consumedInvite = await invitesStore.consume(outgoingInvite.inviteId, {
          actor: req.player,
          actorUserId: req.tgUser.id,
          role: 'initiator',
        })
      } catch (err) {
        log.error('Не удалось погасить прямое приглашение при отмене поиска', { message: err.message })
      }
    }
    const result = await context.cancelSearch.execute(req.player, req.identityToken)
    if (result.status === 'removed') {
      if (consumedInvite) {
        discardSearchAnnouncement(req.player)
        notifyPlayerDirect(
          consumedInvite.opponentIdentity?.userId,
          messages.directCancelled({ from: consumedInvite.player, to: consumedInvite.opponent })
        )
      } else {
        // Игрок передумал: анонс "хочет поиграть" убираем без комментариев.
        await removeSearchAnnouncement(req.player)
      }
    }
    sseManager.broadcast('state_update', await buildStatePayload())
    return { ok: result.status === 'removed', status: result.status }
  })

  // POST /api/match — принять соперника (play_with)
  app.post('/api/match', { preHandler: [auth, requireVerified] }, async (req, reply) => {
    const { opponent } = req.body
    if (await isUsernameBanned(opponent)) {
      return reply.code(403).send({ error: 'player_banned' })
    }
    const currentState = await context.repository.get()
    const opponentIdentity = currentState.searchingIdentities?.[opponent]
    const result = await context.addMatch.execute(opponent, req.player, {
      scheduleLifecycle: !isPauseModeEnabled(queueChatId),
      participantIdentities: {
        [opponent]: opponentIdentity,
        [req.player]: req.identityToken,
      },
    })
    if (result.ok) {
      sseManager.broadcast('state_update', await buildStatePayload())
      // Приглашение принято: анонс "хочет поиграть" заменяем на анонс матча.
      // Не ждём Telegram — ответ клиенту не должен зависеть от его задержек.
      resolveSearchAnnouncement(opponent, req.player, result.match)
      discardOrphanedSearchAnnouncements(result.orphanedSearchers)
    }
    return { ok: result.ok, reason: result.reason }
  })

  // DELETE /api/match — нет времени
  app.delete('/api/match', { preHandler: [auth, requireVerified] }, async (req) => {
    const result = await context.cancelMatch.execute(req.player, req.identityToken)
    if (result.ok) sseManager.broadcast('state_update', await buildStatePayload())
    return { ok: result.ok, status: result.status }
  })

  // POST /api/direct — прямое приглашение
  app.post('/api/direct', { preHandler: [auth, requireVerified] }, async (req, reply) => {
    const { opponent } = req.body

    const normalizedOpponent = context.directMatch.normalizeOpponent(opponent)
    if (await isUsernameBanned(normalizedOpponent)) {
      return reply.code(403).send({ error: 'player_banned' })
    }
    if (!normalizedOpponent) {
      const result = await context.directMatch.execute(req.player, opponent, { identityToken: req.identityToken })
      return { ok: result.ok, reason: result.reason }
    }
    const currentState = await context.repository.get()
    const opponentIdentity = typeof currentState.getActiveIdentity === 'function'
      ? currentState.getActiveIdentity(normalizedOpponent)
      : null
    if (!opponentIdentity) {
      return reply.code(503).send({ error: 'opponent_identity_unavailable' })
    }
    if (typeof invitesStore.getByPlayer === 'function' && await invitesStore.getByPlayer(req.player)) {
      return { ok: false, reason: 'invite_exists' }
    }
    // У оппонента уже есть собственное исходящее приглашение — если он примет
    // наше, его приглашение осиротеет (тот же сценарий, что и с общим поиском:
    // его "поиск" на бэкенде держится именно тем приглашением). Список игроков
    // в мини-аппе уже скрывает таких оппонентов, но ручной ввод username его
    // обходит — проверяем и на бэкенде.
    if (typeof invitesStore.getByPlayer === 'function' && await invitesStore.getByPlayer(normalizedOpponent)) {
      return { ok: false, reason: 'opponent_invite_pending' }
    }
    let invite
    try {
      invite = await invitesStore.create({
        player: req.player,
        opponent: normalizedOpponent,
        playerIdentity: req.identityToken,
        opponentIdentity,
        createdAt: Date.now(),
      })
    } catch (err) {
      log.error('Не удалось создать прямое приглашение', { message: err.message })
      return reply.code(503).send({ error: 'invite_storage_unavailable' })
    }
    if (!invite) return { ok: false, reason: 'invite_exists' }

    let result
    try {
      result = await context.directMatch.execute(req.player, normalizedOpponent, {
        identityToken: req.identityToken,
        opponentIdentity,
      })
    } catch (err) {
      await invitesStore.deleteById?.(invite.inviteId)
      throw err
    }
    if (!result.ok) {
      await invitesStore.deleteById?.(invite.inviteId)
      return { ok: false, reason: result.reason }
    }

    if (result.ok) {
      const delivery = await sendDirectInviteNotification({
        bot,
        playersRepository,
        invite,
        text: messages.directInvite({ from: invite.player, to: invite.opponent }),
        replyMarkup: buildDirectInviteKeyboard(invite, ui),
        directReplyMarkup: buildDirectInviteRecipientKeyboard(invite, ui),
        fallbackChatId: queueChatId,
        log,
      }).catch(() => log.error('Не удалось отправить уведомление о прямом приглашении', {
        reason: 'notification_failed',
      }))
      if (delivery?.sentDirect) {
        // Прямое приглашение не анонсируем в общий чат — подтверждение уходит инициатору в ЛС.
        notifyDirectInviteInitiator({
          bot,
          invite,
          text: messages.directInviteSent({ from: invite.player, to: invite.opponent }),
          replyMarkup: buildDirectInviteInitiatorKeyboard(invite, ui),
          fallbackChatId: queueChatId,
          log,
        }).catch((error) => log.warn('Не удалось отправить подтверждение прямого приглашения инициатору', {
          message: error.message,
        }))
      }
      sseManager.broadcast('state_update', await buildStatePayload())
    }
    return { ok: result.ok, reason: result.reason }
  })

  // POST /api/direct/accept — принять прямое приглашение
  app.post('/api/direct/accept', { preHandler: [auth, requireVerified] }, async (req, reply) => {
    const { inviteId } = req.body || {}
    let invite
    try {
      const pending = typeof invitesStore.getById === 'function' ? await invitesStore.getById(inviteId) : null
      if (pending && !(await isInviteParticipantAuthorized(pending, req.player, req.tgUser.id, 'opponent'))) {
        return { ok: false, reason: 'invite_not_found' }
      }
      if (!pending) return { ok: false, reason: 'invite_not_found' }
      const currentState = await context.repository.get()
      if (!currentState.isActiveIdentity?.(req.identityToken)
        || !QueueState.sameIdentity(currentState.getActiveIdentity?.(req.player), pending.opponentIdentity)) {
        return { ok: false, reason: 'invite_not_found' }
      }
      invite = await invitesStore.consume(inviteId, {
        actor: req.player,
        actorUserId: req.tgUser.id,
        role: 'opponent',
      })
    } catch (err) {
      log.error('Не удалось принять прямое приглашение', { message: err.message })
      return reply.code(503).send({ error: 'invite_storage_unavailable' })
    }
    if (!invite) return { ok: false, reason: 'invite_not_found' }

    if (await isInviteInitiatorBanned(invite)) {
      return reply.code(403).send({ error: 'player_banned' })
    }

    const result = await context.addMatch.execute(invite.player, req.player, {
      scheduleLifecycle: !isPauseModeEnabled(queueChatId),
      participantIdentities: {
        [invite.player]: invite.playerIdentity,
        [req.player]: req.identityToken,
      },
      inviteIdentities: {
        [invite.player]: invite.playerIdentity,
        [req.player]: invite.opponentIdentity,
      },
    })
    if (result.ok) {
      sseManager.broadcast('state_update', await buildStatePayload())
      // Инициатор мог параллельно висеть в общем поиске из мини-аппа — этот
      // анонс тоже больше не актуален, раз матч уже создан через приглашение.
      // Telegram не ждём — это не должно задерживать ответ клиенту.
      resolveSearchAnnouncement(invite.player, req.player, result.match)
      discardOrphanedSearchAnnouncements(result.orphanedSearchers)
      notifyChat(messages.directAccepted({ from: invite.player, to: req.player }))
    } else {
      sseManager.broadcast('state_update', await buildStatePayload())
    }
    return { ok: result.ok, reason: result.reason }
  })

  // POST /api/direct/decline — отклонить прямое приглашение
  app.post('/api/direct/decline', { preHandler: [auth, requireVerified] }, async (req, reply) => {
    const { inviteId } = req.body || {}
    let invite
    try {
      const pending = typeof invitesStore.getById === 'function' ? await invitesStore.getById(inviteId) : null
      if (pending && !(await isInviteParticipantAuthorized(pending, req.player, req.tgUser.id, 'opponent'))) {
        return { ok: false, reason: 'invite_not_found' }
      }
      if (!pending) return { ok: false, reason: 'invite_not_found' }
      const currentState = await context.repository.get()
      if (!currentState.isActiveIdentity?.(req.identityToken)
        || !QueueState.sameIdentity(currentState.getActiveIdentity?.(req.player), pending.opponentIdentity)) {
        return { ok: false, reason: 'invite_not_found' }
      }
      invite = await invitesStore.consume(inviteId, {
        actor: req.player,
        actorUserId: req.tgUser.id,
        role: 'opponent',
      })
    } catch (err) {
      log.error('Не удалось отклонить прямое приглашение', { message: err.message })
      return reply.code(503).send({ error: 'invite_storage_unavailable' })
    }
    if (!invite) return { ok: false, reason: 'invite_not_found' }

    await context.cancelSearch.execute(invite.player, invite.playerIdentity)
    sseManager.broadcast('state_update', await buildStatePayload())
    // Приглашение никто не принял — это личное дело двоих, общий чат об этом
    // знать не должен (в отличие от direct-accept, который уже создаёт матч).
    // Инициатора уведомляем в ЛС, чтобы он не ждал ответа впустую.
    discardSearchAnnouncement(invite.player)
    notifyPlayerDirect(
      invite.playerIdentity?.userId,
      messages.directDeclined({ from: invite.player, to: invite.opponent })
    )
    return { ok: true }
  })

  // POST /api/direct/cancel — отменить своё прямое приглашение
  app.post('/api/direct/cancel', { preHandler: [auth, requireVerified] }, async (req, reply) => {
    const { inviteId } = req.body || {}
    let invite
    try {
      const pending = typeof invitesStore.getById === 'function' ? await invitesStore.getById(inviteId) : null
      if (pending && !(await isInviteParticipantAuthorized(pending, req.player, req.tgUser.id, 'initiator'))) {
        return { ok: false, reason: 'invite_not_found' }
      }
      invite = await invitesStore.consume(inviteId, {
        actor: req.player,
        actorUserId: req.tgUser.id,
        role: 'initiator',
      })
    } catch (err) {
      log.error('Не удалось отменить прямое приглашение', { message: err.message })
      return reply.code(503).send({ error: 'invite_storage_unavailable' })
    }
    if (!invite) return { ok: false, reason: 'invite_not_found' }

    await context.cancelSearch.execute(req.player, invite.playerIdentity)
    sseManager.broadcast('state_update', await buildStatePayload())
    // Приглашение никто не принял — это личное дело двоих, общий чат об этом
    // знать не должен (в отличие от direct-accept, который уже создаёт матч).
    // Целевого игрока уведомляем в ЛС, а не в общий чат.
    discardSearchAnnouncement(req.player)
    notifyPlayerDirect(
      invite.opponentIdentity?.userId,
      messages.directCancelled({ from: invite.player, to: invite.opponent })
    )
    return { ok: true }
  })

  // POST /api/admin/pause — включить режим паузы
  // applyPauseMode сам отправляет сообщение в Telegram через respondEmergeMessage
  app.post('/api/admin/pause', { preHandler: [auth, requireVerified, requireAdmin] }, async (req) => {
    if (isPauseModeEnabled(queueChatId)) {
      return { ok: false, reason: 'already_paused' }
    }
    const result = await applyPauseMode({
      chatId: queueChatId,
      context,
      username: req.tgUser.username,
    })
    if (result?.conflict) {
      // Состояние не изменено из-за конкурирующей записи — операцию можно повторить
      sseManager.broadcast('state_update', await buildStatePayload())
      return { ok: false, reason: 'conflict' }
    }
    sseManager.broadcast('state_update', await buildStatePayload())
    return { ok: true }
  })

  // POST /api/admin/continue — снять режим паузы
  app.post('/api/admin/continue', { preHandler: [auth, requireVerified, requireAdmin] }, async () => {
    const emergeResult = await resumeEmergeAfterContinue({ chatId: queueChatId, context })
    const pauseEnabled = isPauseModeEnabled(queueChatId)

    if (!pauseEnabled && !emergeResult.handled) {
      return { ok: false, reason: 'not_paused' }
    }

    if (pauseEnabled) {
      const resumeResult = await resumeQueueAfterPause(context)

      // Состояние не изменено из-за конкурирующей записи — операцию можно повторить
      if (resumeResult.conflict) {
        sseManager.broadcast('state_update', await buildStatePayload())
        return { ok: false, reason: 'conflict' }
      }

      // Уведомить Telegram чат о снятии паузы
      if (!resumeResult.hasQueue) {
        notifyChat(messages.pauseModeDisabledNoQueue())
      } else if (resumeResult.currentMatchContinues) {
        notifyChat(
          messages.pauseModeDisabledCurrent({
            player1: resumeResult.currentMatch.player1,
            player2: resumeResult.currentMatch.player2,
            endDate: resumeResult.currentMatch.endDate,
          })
        )
      } else {
        notifyChat(
          messages.pauseModeDisabled({
            player1: resumeResult.nextMatch.player1,
            player2: resumeResult.nextMatch.player2,
            startDate: resumeResult.nextMatch.startDate,
          })
        )
      }

      sseManager.broadcast('state_update', await buildStatePayload())
      return { ok: true, resumed: resumeResult }
    }

    sseManager.broadcast('state_update', await buildStatePayload())
    return { ok: true }
  })

  // POST /api/admin/emerge — экстренная пауза матча
  // handleEmerge сам отправляет сообщение в Telegram через respondEmergeMessage
  app.post('/api/admin/emerge', { preHandler: [auth, requireVerified, requireAdmin] }, async (req) => {
    await handleEmerge({ chatId: queueChatId, context, userId: req.tgUser.id })
    sseManager.broadcast('state_update', await buildStatePayload())
    return { ok: true }
  })

  // Dev-only: управление состоянием для локальной отладки
  if (isDev) {
    const getFreePlayers = async (state, excluded = []) => {
      const all = await playersRepository.findAll()
      const busy = new Set([
        ...excluded,
        ...state.queue.flatMap(m => [m.player1, m.player2]),
        ...state.searching,
        ...state.played,
      ])
      return all
        .filter((player) => player.banned !== true)
        .map(p => p.username)
        .filter(u => !busy.has(u))
    }

    const pickRandom = (arr) =>
      arr.length ? arr[Math.floor(Math.random() * arr.length)] : null

    const ensureActiveIdentity = async (state, username, userId = undefined) => {
      const current = state.getActiveIdentity?.(username)
      if (current) return current
      if (!activateTestIdentity) return null
      // Тот же дефолт, что и в цикле сидирования игроков ниже: @dev_user без
      // явного userId должен клеймиться под настоящим DEV_USER_ID, а не под
      // синтетическим test-user:@dev_user — иначе первый же authenticated-
      // запрос переклеймит его под другим id и потеряет verified/generation.
      const resolvedUserId = userId ?? (username === DEV_USERNAME ? DEV_USER_ID : undefined)
      return activateTestIdentity({ username, userId: resolvedUserId })
    }

    // Сид состояния: игроки + очередь + инвайты.
    // Вызывается фронтендом при старте и при сбросе через тулбар.
    app.post('/api/dev/seed', async (req) => {
      const { players = [], state: stateData = {}, force = false } = req.body || {}

      const seededIdentities = {}
      for (const player of players) {
        const username = player.username?.startsWith('@') ? player.username : `@${player.username}`
        // @dev_user без явного userId иначе получил бы синтетический
        // test-user:@dev_user (createTestIdentityHelper) — а любой
        // authenticated-запрос из мини-аппа без initData claim'ит его заново
        // под настоящим DEV_USER_ID. upsert() трактует смену userId для того
        // же username как передачу владения новому человеку: отсоединяет эту
        // сид-запись (verified, generation, все её identity-ссылки в
        // pendingInvites) и заводит чистую — verified терялся, а сид-инвайты
        // на @dev_user переставали приниматься/отклоняться (identity уже не
        // совпадает). Подставляя тот же userId здесь, сидируем ровно ту
        // запись, которую позже claim'ит настоящий dev-fallback — идентичность
        // не рвётся вообще, и терять нечего.
        const userId = player.userId ?? (username === DEV_USERNAME ? DEV_USER_ID : undefined)
        seededIdentities[username] = await activateTestIdentity({
          ...player,
          username,
          userId,
        })
        // Dev/mock-сиды не должны застревать на логин-экране — verified
        // выставляется отдельно от upsert() (см. isUserVerified/setVerified),
        // сид-эндпоинт целиком под if (isDev) и никогда не работает в проде.
        if (typeof playersRepository.setVerified === 'function') {
          await playersRepository.setVerified(username, true)
        }
      }

      const existingState = await context.repository.get()
      const hasData = existingState.queue.length > 0
        || existingState.searching.length > 0
        || existingState.played.length > 0

      if (force || !hasData) {
        const identityFor = async (username, fallbackIdentity = undefined) => {
          if (seededIdentities[username]) return seededIdentities[username]
          const identity = fallbackIdentity || {}
          const active = await ensureActiveIdentity(existingState, username, identity.userId)
          if (!active) throw new Error(`identity unavailable for ${username}`)
          seededIdentities[username] = active
          return active
        }
        const searchingIdentities = {}
        for (const username of stateData.searching || []) {
          searchingIdentities[username] = await identityFor(
            username,
            stateData.searchingIdentities?.[username],
          )
        }
        const queue = []
        for (const match of stateData.queue || []) {
          const player1Identity = await identityFor(
            match.player1,
            match.participantIdentities?.[match.player1],
          )
          const player2Identity = await identityFor(
            match.player2,
            match.participantIdentities?.[match.player2],
          )
          queue.push({
            ...match,
            participantIdentities: {
              [match.player1]: player1Identity,
              [match.player2]: player2Identity,
            },
          })
        }
        for (const username of stateData.played || []) await identityFor(username)
        for (const invite of stateData.pendingInvites || []) {
          await identityFor(invite.player, invite.playerIdentity)
          await identityFor(invite.opponent, invite.opponentIdentity)
        }
        const identityEpoch = Math.max(
          Number(existingState.identityEpoch) || 0,
          Number(stateData.identityEpoch) || 0,
          ...Object.values(seededIdentities).map((identity) => identity.generation),
        )
        const queueState = QueueState.from({
          ...stateData,
          queue,
          searchingIdentities,
          identityEpoch,
          ownership: Object.fromEntries(Object.entries(seededIdentities).map(([username, identity]) => [
            username,
            { userId: identity.userId, generation: identity.generation, status: 'active' },
          ])),
          identityTombstones: stateData.identityTombstones || existingState.identityTombstones,
        })
        await context.repository.save(queueState)

        await invitesStore.clear()
        for (const invite of (stateData.pendingInvites || [])) {
          const created = await invitesStore.create({
            player: invite.player,
            opponent: invite.opponent,
            playerIdentity: seededIdentities[invite.player],
            opponentIdentity: seededIdentities[invite.opponent],
            createdAt: invite.createdAt,
          })
          if (!created) throw new Error(`invite unavailable for ${invite.player}`)
        }

        setPauseMode(queueChatId, false)
        emergeStateByChat.delete(String(queueChatId))

        context.orchestrator.cancelAll()
        await recoverTimers({ repository: context.repository, orchestrator: context.orchestrator, clock: context.clock })
      }

      sseManager.broadcast('state_update', await buildStatePayload())
      return { ok: true }
    })

    app.post('/api/dev/mark-played', { preHandler: [auth] }, async (req) => {
      const state = await context.repository.get()
      if (!state.isPlayed(req.player)) {
        state.removeSearching(req.player, req.identityToken)
        const { index } = state.removeMatchByPlayer(req.player)

        if (index === -1 && state.queue.length > 0) {
          // Dev user not in any match — simulate end of the current playing match
          const finished = state.queue.shift()
          state.played.push(finished.player1, finished.player2)
          if (state.queue.length > 0) {
            const next = state.queue[0]
            next.status = 'playing'
            next.startDate = new Date(context.clock.now().getTime() + context.queueService.readyMs)
            next.endDate = new Date(next.startDate.getTime() + context.queueService.gameMs)
            context.queueService.recalculateWaiting(state)
          }
          context.orchestrator.cancelAll()
          await context.repository.save(state)
          await recoverTimers({ repository: context.repository, orchestrator: context.orchestrator, clock: context.clock })
        } else {
          if (index === 0 && state.queue.length > 0) {
            context.queueService.recalculateWaiting(state)
          }
          state.played.push(req.player)
          await invitesStore.deleteByPlayer(req.player)
          await context.repository.save(state)
        }
      }
      sseManager.broadcast('state_update', await buildStatePayload())
      return { ok: true }
    })

    app.post('/api/dev/add-pair', { preHandler: [auth] }, async (req) => {
      const state = await context.repository.get()
      const free = await getFreePlayers(state, [req.player])
      if (free.length < 2) return { ok: false, reason: 'not_enough_players' }

      const [p1, p2] = free.sort(() => Math.random() - 0.5)
      state.played = state.played.filter(p => p !== p1 && p !== p2)
      const p1Identity = await ensureActiveIdentity(state, p1)
      const p2Identity = await ensureActiveIdentity(state, p2)
      if (!p1Identity || !p2Identity) return { ok: false, reason: 'identity_unavailable' }
      const searchResult = await context.registerSearch.execute(p1, p1Identity)
      if (!['added', 'already_searching'].includes(searchResult.status)) {
        return { ok: false, reason: searchResult.status }
      }
      const result = await context.addMatch.execute(p1, p2, {
        scheduleLifecycle: !isPauseModeEnabled(queueChatId),
        participantIdentities: { [p1]: p1Identity, [p2]: p2Identity },
      })
      if (!result.ok) return { ok: false, reason: result.reason }
      sseManager.broadcast('state_update', await buildStatePayload())
      return { ok: true, player1: p1, player2: p2 }
    })

    app.post('/api/dev/accept-invite', { preHandler: [auth] }, async (req, reply) => {
      const state = await context.repository.get()
      const outgoing = await invitesStore.getByPlayer(req.player)
      if (outgoing?.opponent && await isUsernameBanned(outgoing.opponent)) {
        return reply.code(403).send({ error: 'player_banned' })
      }
      const partner = outgoing?.opponent
        ?? pickRandom(await getFreePlayers(state, [req.player]))
      if (!partner) return { ok: false, reason: 'not_enough_players' }

      const playerIdentity = req.identityToken
      const partnerIdentity = outgoing?.opponentIdentity || await ensureActiveIdentity(state, partner)
      if (!partnerIdentity) return { ok: false, reason: 'identity_unavailable' }

      state.played = state.played.filter(p => p !== req.player && p !== partner)
      state.removeSearching(req.player, playerIdentity)
      state.removeSearching(partner, partnerIdentity)
      state.removeMatchByPlayer(req.player)
      state.removeMatchByPlayer(partner)
      if (outgoing) await invitesStore.deleteByPlayer(req.player)
      await context.repository.save(state)
      const searchResult = await context.registerSearch.execute(req.player, playerIdentity)
      if (!['added', 'already_searching'].includes(searchResult.status)) {
        return { ok: false, reason: searchResult.status }
      }
      const result = await context.addMatch.execute(req.player, partner, {
        scheduleLifecycle: !isPauseModeEnabled(queueChatId),
        participantIdentities: { [req.player]: playerIdentity, [partner]: partnerIdentity },
        inviteIdentities: outgoing ? {
          [req.player]: outgoing.playerIdentity,
          [partner]: outgoing.opponentIdentity,
        } : {},
      })
      if (!result.ok) return { ok: false, reason: result.reason }
      sseManager.broadcast('state_update', await buildStatePayload())
      return { ok: true, player: partner }
    })

    app.post('/api/dev/receive-invite', { preHandler: [auth] }, async (req) => {
      const state = await context.repository.get()
      const sender = pickRandom(await getFreePlayers(state, [req.player]))
      if (!sender) return { ok: false, reason: 'not_enough_players' }

      const senderIdentity = await ensureActiveIdentity(state, sender)
      if (!senderIdentity) return { ok: false, reason: 'identity_unavailable' }
      state.played = state.played.filter(p => p !== sender)
      await context.repository.save(state)
      const searchResult = await context.registerSearch.execute(sender, senderIdentity)
      if (!['added', 'already_searching'].includes(searchResult.status)) {
        return { ok: false, reason: searchResult.status }
      }
      const invite = await invitesStore.create({
        player: sender,
        opponent: req.player,
        playerIdentity: senderIdentity,
        opponentIdentity: req.identityToken,
        createdAt: Date.now(),
      })
      if (!invite) {
        await context.cancelSearch.execute(sender, senderIdentity)
        return { ok: false, reason: 'invite_exists' }
      }
      sseManager.broadcast('state_update', await buildStatePayload())
      return { ok: true, player: sender }
    })
  }
}
