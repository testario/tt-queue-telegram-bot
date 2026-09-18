import { jest } from '@jest/globals'
import { buildLocalAdminState } from '#interfaces/webapp/index.js'
import { Match } from '#domain/entities/Match.js'
import { QueueState } from '#domain/entities/QueueState.js'

const createContext = (current, now) => {
  const state = new QueueState({ queue: [current] })
  const next = new Match({
    player1: '@next1',
    player2: '@next2',
    startDate: new Date(now.getTime() + 60_000),
    endDate: new Date(now.getTime() + 3_660_000),
    status: Match.statuses.waiting,
  })
  state.enqueue(next)
  let revision = 0
  return {
    chatId: 'queue',
    state,
    repository: {
      getVersioned: jest.fn().mockResolvedValue({ state, revision }),
      saveIfRevision: jest.fn(async (expectedRevision, nextState) => {
        if (expectedRevision !== revision) return false
        revision += 1
        nextState && Object.assign(state, nextState)
        return true
      }),
    },
    notifier: { notify: jest.fn() },
    clock: { now: () => now },
    queueService: { recalculateWaiting: jest.fn() },
  }
}

describe('backend-only pause state', () => {
  const now = new Date('2026-01-01T12:00:00.000Z')
  const messages = { pauseModeEnabled: jest.fn(() => 'paused') }
  const bot = { sendMessage: jest.fn().mockResolvedValue(undefined) }

  test('holds the current match before continuation threshold and publishes wakeup', async () => {
    const current = new Match({
      player1: '@current1',
      player2: '@current2',
      startDate: new Date('2026-01-01T11:59:00.000Z'),
      endDate: new Date('2026-01-01T13:00:00.000Z'),
      status: Match.statuses.playing,
    })
    const context = createContext(current, now)
    const adminState = buildLocalAdminState({
      bot,
      messages,
      isDev: true,
    })

    await adminState.applyPauseMode({ chatId: 'queue', context })

    expect(context.state.queue[0].status).toBe(Match.statuses.waiting)
    expect(context.state.queue[1].status).toBe(Match.statuses.waiting)
    expect(context.notifier.notify).toHaveBeenCalledWith('queue', '', { type: 'state_update' })
  })

  test('keeps a continuation-eligible current match playing', async () => {
    const current = new Match({
      player1: '@current1',
      player2: '@current2',
      startDate: new Date('2026-01-01T11:00:00.000Z'),
      endDate: new Date('2026-01-01T13:00:00.000Z'),
      status: Match.statuses.playing,
    })
    const context = createContext(current, now)
    const adminState = buildLocalAdminState({
      bot,
      messages,
      isDev: true,
    })

    await adminState.applyPauseMode({ chatId: 'queue', context })

    expect(context.state.queue[0].status).toBe(Match.statuses.playing)
    expect(context.state.queue[1].status).toBe(Match.statuses.waiting)
    expect(context.notifier.notify).toHaveBeenCalledWith('queue', '', { type: 'state_update' })
  })

  test('retries pause CAS after lifecycle completion and preserves the latest durable state', async () => {
    const current = new Match({
      player1: '@current1',
      player2: '@current2',
      startDate: new Date('2026-01-01T11:00:00.000Z'),
      endDate: new Date('2026-01-01T13:00:00.000Z'),
      status: Match.statuses.playing,
    })
    const context = createContext(current, now)
    let latestState = new QueueState({ played: ['@finished'] })
    latestState.enqueue(current)
    context.repository.getVersioned
      .mockResolvedValueOnce({ state: context.state, revision: 0 })
      .mockResolvedValueOnce({ state: latestState, revision: 1 })
    context.repository.saveIfRevision
      .mockImplementationOnce(async () => {
        return false
      })
      .mockImplementationOnce(async (expectedRevision, nextState) => {
        expect(expectedRevision).toBe(1)
        latestState = nextState
        return true
      })
    const adminState = buildLocalAdminState({
      bot,
      messages,
      isDev: true,
    })

    await adminState.applyPauseMode({ chatId: 'queue', context })

    expect(latestState.played).toEqual(['@finished'])
    expect(latestState.holdNextMatch).toBe(true)
    expect(context.repository.getVersioned).toHaveBeenCalledTimes(2)
  })

  test('does not enable local pause state when all pause CAS attempts conflict', async () => {
    const current = new Match({
      player1: '@current1',
      player2: '@current2',
      startDate: new Date('2026-01-01T11:59:00.000Z'),
      endDate: new Date('2026-01-01T13:00:00.000Z'),
      status: Match.statuses.playing,
    })
    const context = createContext(current, now)
    const durableState = context.state.clone()
    context.repository.getVersioned.mockImplementation(async () => ({
      state: durableState.clone(),
      revision: 0,
    }))
    context.repository.saveIfRevision.mockResolvedValue(false)
    const adminState = buildLocalAdminState({
      bot,
      messages,
      isDev: true,
      logger: { warn: jest.fn() },
    })

    const result = await adminState.applyPauseMode({ chatId: 'queue', context })

    // Конфликт сообщается флагом: состояние не изменено, операцию можно повторить
    expect(result).toEqual({ hasQueue: false, conflict: true })

    expect(adminState.isPauseModeEnabled('queue')).toBe(false)
    expect(durableState.queue[0].status).toBe(Match.statuses.playing)
    expect(durableState.holdNextMatch).toBe(false)
    expect(context.repository.saveIfRevision).toHaveBeenCalledTimes(3)
  })

  test('does not disable local pause state when all resume CAS attempts conflict', async () => {
    const current = new Match({
      player1: '@current1',
      player2: '@current2',
      startDate: new Date('2026-01-01T11:59:00.000Z'),
      endDate: new Date('2026-01-01T13:00:00.000Z'),
      status: Match.statuses.playing,
    })
    const context = createContext(current, now)
    const adminState = buildLocalAdminState({
      bot,
      messages,
      isDev: true,
    })
    await adminState.applyPauseMode({ chatId: 'queue', context })

    const durableState = context.state.clone()
    context.repository.getVersioned.mockImplementation(async () => ({
      state: durableState.clone(),
      revision: 1,
    }))
    context.repository.saveIfRevision.mockResolvedValue(false)

    const resumeResult = await adminState.resumeQueueAfterPause(context)

    // Конфликт сообщается флагом: состояние не изменено, операцию можно повторить
    expect(resumeResult).toEqual({ hasQueue: false, conflict: true })

    expect(adminState.isPauseModeEnabled('queue')).toBe(true)
    expect(durableState.queue[0].status).toBe(Match.statuses.waiting)
    expect(durableState.holdNextMatch).toBe(false)
    expect(context.repository.saveIfRevision).toHaveBeenCalledTimes(4)
  })
})
