import { verifyInitData } from './auth.js'
import { buildSearchInlineKeyboard, buildDirectInviteKeyboard } from '#interfaces/telegram/keyboards.js'
import { QueueState } from '#domain'
import { recoverTimers } from '#infrastructure/timers/recoverTimers.js'

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

  const buildStatePayload = async () => {
    const state = await context.repository.get()
    return {
      queue: state.queue,
      searching: state.searching,
      played: state.played,
      paused: isPauseModeEnabled(queueChatId),
      emergeActive: emergeStateByChat.has(String(queueChatId)),
      serverTime: context.clock.now().toISOString(),
      pendingInvites: await invitesStore.getAll(),
    }
  }

  // --- preHandlers ---

  const isDev = process.env.NODE_ENV !== 'production'

  const notifyChat = isDev
    ? () => {}
    : (text, replyMarkup = undefined) =>
        bot
          .sendMessage(queueChatId, text, replyMarkup ? { reply_markup: replyMarkup } : undefined)
          .catch((err) => log.error('Не удалось уведомить чат из webapp', { message: err.message }))

  const auth = async (req, reply) => {
    const initData = req.headers['x-telegram-init-data']

    // В dev-режиме пропускаем без initData (для тестирования через браузер)
    if (isDev && !initData) {
      req.tgUser = { id: 123456, username: 'dev_user', firstName: 'Dev', lastName: '' }
      req.player = '@dev_user'
      return
    }

    const result = verifyInitData(initData, process.env.TG_BOT_API_TOKEN)
    if (!result.ok) return reply.code(401).send({ error: result.reason })
    if (!result.user.username) return reply.code(400).send({ error: 'username_required' })
    req.tgUser = result.user
    req.player = `@${result.user.username}`
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

    sseManager.addClient(reply.raw)

    // Сразу отправить текущее состояние
    const payload = await buildStatePayload()
    reply.raw.write(`event: state_update\ndata: ${JSON.stringify(payload)}\n\n`)
  })

  // GET /api/players — список известных игроков
  app.get('/api/players', async () => {
    const players = await playersRepository.findAll()
    return { players: players.map(({ userId, ...rest }) => rest) }
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

  // DELETE /api/players/:username — удалить игрока (только admin)
  app.delete('/api/players/:username', { preHandler: [auth, requireAdmin] }, async (req, reply) => {
    const atUsername = `@${req.params.username}`
    const deleted = await playersRepository.deleteOne(atUsername)
    if (!deleted) return reply.code(404).send({ error: 'player_not_found' })
    return { ok: true }
  })

  // POST /api/search — встать в поиск
  app.post('/api/search', { preHandler: [auth] }, async (req) => {
    const result = await context.registerSearch.execute(req.player)
    if (result.status === 'added') {
      notifyChat(messages.searchAdded(req.player), buildSearchInlineKeyboard(req.player, ui))
    }
    sseManager.broadcast('state_update', await buildStatePayload())
    return { ok: true, status: result.status }
  })

  // DELETE /api/search — отменить поиск
  app.delete('/api/search', { preHandler: [auth] }, async (req) => {
    const result = await context.cancelSearch.execute(req.player)
    if (result.status === 'removed') {
      notifyChat(messages.searchCancelled())
    }
    sseManager.broadcast('state_update', await buildStatePayload())
    return { ok: result.status === 'removed', status: result.status }
  })

  // POST /api/match — принять соперника (play_with)
  app.post('/api/match', { preHandler: [auth] }, async (req) => {
    const { opponent } = req.body
    const result = await context.addMatch.execute(opponent, req.player, {
      scheduleLifecycle: !isPauseModeEnabled(queueChatId),
    })
    if (result.ok) sseManager.broadcast('state_update', await buildStatePayload())
    return { ok: result.ok, reason: result.reason }
  })

  // DELETE /api/match — нет времени
  app.delete('/api/match', { preHandler: [auth] }, async (req) => {
    const result = await context.cancelMatch.execute(req.player)
    if (result.ok) sseManager.broadcast('state_update', await buildStatePayload())
    return { ok: result.ok, status: result.status }
  })

  // POST /api/direct — прямое приглашение
  app.post('/api/direct', { preHandler: [auth] }, async (req) => {
    const { opponent } = req.body
    const result = await context.directMatch.execute(req.player, opponent)
    if (result.ok) {
      const { invite } = result
      await invitesStore.set(req.player, { player: req.player, opponent, createdAt: Date.now() })
      notifyChat(
        messages.directInvite({ from: invite.player, to: invite.opponent }),
        buildDirectInviteKeyboard(invite, ui)
      )
      sseManager.broadcast('state_update', await buildStatePayload())
    }
    return { ok: result.ok, reason: result.reason }
  })

  // POST /api/direct/accept — принять прямое приглашение
  app.post('/api/direct/accept', { preHandler: [auth] }, async (req) => {
    const { player } = req.body
    const result = await context.addMatch.execute(player, req.player, {
      scheduleLifecycle: !isPauseModeEnabled(queueChatId),
    })
    if (result.ok) {
      await invitesStore.delete(player)
      notifyChat(messages.directAccepted({ from: player, to: req.player }))
      sseManager.broadcast('state_update', await buildStatePayload())
    }
    return { ok: result.ok, reason: result.reason }
  })

  // POST /api/direct/decline — отклонить прямое приглашение
  app.post('/api/direct/decline', { preHandler: [auth] }, async (req) => {
    const { player } = req.body
    await invitesStore.delete(player)
    await context.cancelSearch.execute(player)
    notifyChat(messages.directDeclined({ from: player, to: req.player }))
    sseManager.broadcast('state_update', await buildStatePayload())
    return { ok: true }
  })

  // POST /api/direct/cancel — отменить своё прямое приглашение
  app.post('/api/direct/cancel', { preHandler: [auth] }, async (req) => {
    const { opponent } = req.body
    await invitesStore.delete(req.player)
    await context.cancelSearch.execute(req.player)
    notifyChat(messages.directCancelled({ from: req.player, to: opponent }))
    sseManager.broadcast('state_update', await buildStatePayload())
    return { ok: true }
  })

  // POST /api/admin/pause — включить режим паузы
  // applyPauseMode сам отправляет сообщение в Telegram через respondEmergeMessage
  app.post('/api/admin/pause', { preHandler: [auth, requireAdmin] }, async (req, reply) => {
    if (isPauseModeEnabled(queueChatId)) {
      return { ok: false, reason: 'already_paused' }
    }
    await applyPauseMode({
      chatId: queueChatId,
      context,
      username: req.tgUser.username,
    })
    sseManager.broadcast('state_update', await buildStatePayload())
    return { ok: true }
  })

  // POST /api/admin/continue — снять режим паузы
  app.post('/api/admin/continue', { preHandler: [auth, requireAdmin] }, async (req, reply) => {
    const emergeResult = await resumeEmergeAfterContinue({ chatId: queueChatId, context })
    const pauseEnabled = isPauseModeEnabled(queueChatId)

    if (!pauseEnabled && !emergeResult.handled) {
      return { ok: false, reason: 'not_paused' }
    }

    if (pauseEnabled) {
      setPauseMode(queueChatId, false)
      const resumeResult = await resumeQueueAfterPause(context)

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
  app.post('/api/admin/emerge', { preHandler: [auth, requireAdmin] }, async (req) => {
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
      return all.map(p => p.username).filter(u => !busy.has(u))
    }

    const pickRandom = (arr) =>
      arr.length ? arr[Math.floor(Math.random() * arr.length)] : null

    // Сид состояния: игроки + очередь + инвайты.
    // Вызывается фронтендом при старте и при сбросе через тулбар.
    app.post('/api/dev/seed', async (req) => {
      const { players = [], state: stateData = {}, force = false } = req.body || {}

      for (const player of players) {
        await playersRepository.upsert({ ...player, userId: null })
      }

      const existingState = await context.repository.get()
      const hasData = existingState.queue.length > 0
        || existingState.searching.length > 0
        || existingState.played.length > 0

      if (force || !hasData) {
        const queueState = QueueState.from(stateData)
        await context.repository.save(queueState)

        await invitesStore.clear()
        for (const invite of (stateData.pendingInvites || [])) {
          await invitesStore.set(invite.player, invite)
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
        state.removeSearching(req.player)
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
          await invitesStore.delete(req.player)
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
      state.addSearching(p1)

      const result = context.queueService.scheduleMatch(state, p1, p2, context.clock.now())
      if (!result.ok) return { ok: false, reason: result.reason }
      await context.repository.save(result.state)
      sseManager.broadcast('state_update', await buildStatePayload())
      return { ok: true, player1: p1, player2: p2 }
    })

    app.post('/api/dev/accept-invite', { preHandler: [auth] }, async (req) => {
      const state = await context.repository.get()
      const outgoing = (await invitesStore.getAll()).find(inv => inv.player === req.player)
      const partner = outgoing?.opponent
        ?? pickRandom(await getFreePlayers(state, [req.player]))
      if (!partner) return { ok: false, reason: 'not_enough_players' }

      state.played = state.played.filter(p => p !== req.player && p !== partner)
      state.removeSearching(req.player)
      state.removeSearching(partner)
      state.removeMatchByPlayer(req.player)
      state.removeMatchByPlayer(partner)
      if (outgoing) await invitesStore.delete(req.player)

      state.addSearching(req.player)
      const result = context.queueService.scheduleMatch(state, req.player, partner, context.clock.now())
      if (!result.ok) return { ok: false, reason: result.reason }
      await context.repository.save(result.state)
      sseManager.broadcast('state_update', await buildStatePayload())
      return { ok: true, player: partner }
    })

    app.post('/api/dev/receive-invite', { preHandler: [auth] }, async (req) => {
      const state = await context.repository.get()
      const sender = pickRandom(await getFreePlayers(state, [req.player]))
      if (!sender) return { ok: false, reason: 'not_enough_players' }

      state.played = state.played.filter(p => p !== sender)
      state.addSearching(sender)
      await context.repository.save(state)
      await invitesStore.set(sender, { player: sender, opponent: req.player, createdAt: Date.now() })
      sseManager.broadcast('state_update', await buildStatePayload())
      return { ok: true, player: sender }
    })
  }
}