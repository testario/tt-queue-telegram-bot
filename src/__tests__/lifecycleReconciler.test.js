import { describe, expect, it, jest } from '@jest/globals'
import { LifecycleReconciler } from '#infrastructure/timers/LifecycleReconciler.js'
import { QueueState } from '#domain/entities/QueueState.js'

const match = ({ status = 'waiting', startDate, endDate }) => ({
  player1: '@alice',
  player2: '@bob',
  status,
  startDate,
  endDate,
})

const setup = (current) => {
  const state = QueueState.createEmpty()
  if (current) state.enqueue(current)
  const repository = { get: jest.fn().mockResolvedValue(state) }
  const orchestrator = {
    scheduleLifecycle: jest.fn(),
    scheduleFinish: jest.fn(),
    cancelForMatch: jest.fn(),
    handleMatchFinished: jest.fn(),
  }
  const clock = { now: () => new Date('2026-01-01T12:00:00.000Z') }
  const reconciler = new LifecycleReconciler({ repository, orchestrator, clock })
  return { state, repository, orchestrator, reconciler }
}

describe('LifecycleReconciler', () => {
  it('reconciles startup state and deduplicates the same fingerprint', async () => {
    const { orchestrator, reconciler } = setup(match({
      status: 'playing',
      startDate: new Date('2026-01-01T11:00:00.000Z'),
      endDate: new Date('2026-01-01T13:00:00.000Z'),
    }))

    await reconciler.reconcile()
    await reconciler.reconcile()

    expect(orchestrator.scheduleFinish).toHaveBeenCalledTimes(1)
    expect(orchestrator.scheduleLifecycle).not.toHaveBeenCalled()
  })

  it('cancels an old timer before scheduling the changed current playing match', async () => {
    const first = match({
      status: 'playing',
      startDate: new Date('2026-01-01T12:10:00.000Z'),
      endDate: new Date('2026-01-01T13:10:00.000Z'),
    })
    const { state, orchestrator, reconciler } = setup(first)
    await reconciler.reconcile()

    state.queue[0] = match({
      status: 'playing',
      startDate: new Date('2026-01-01T12:20:00.000Z'),
      endDate: new Date('2026-01-01T13:20:00.000Z'),
    })
    await reconciler.reconcile()

    expect(orchestrator.cancelForMatch).toHaveBeenCalledWith(first)
    expect(orchestrator.scheduleLifecycle).toHaveBeenCalledTimes(2)
  })

  it('keeps a playing match during pause when continuation is allowed', async () => {
    const current = match({
      status: 'playing',
      startDate: new Date('2026-01-01T11:00:00.000Z'),
      endDate: new Date('2026-01-01T13:00:00.000Z'),
    })
    const { orchestrator, reconciler } = setup(current)
    reconciler.shouldHold = jest.fn(() => false)

    await reconciler.reconcile()

    expect(reconciler.shouldHold).toHaveBeenCalledWith(current, expect.any(Date))
    expect(orchestrator.scheduleFinish).toHaveBeenCalledWith(current, { scheduleNext: false })
  })

  it('holds a paused current match and never schedules a waiting head', async () => {
    const current = match({
      status: 'waiting',
      startDate: new Date('2026-01-01T11:00:00.000Z'),
      endDate: new Date('2026-01-01T13:00:00.000Z'),
    })
    const { orchestrator, reconciler } = setup(current)
    reconciler.shouldHold = jest.fn(() => true)

    const result = await reconciler.reconcile()

    expect(result.held).toBe(true)
    expect(orchestrator.scheduleFinish).not.toHaveBeenCalled()
    expect(orchestrator.scheduleLifecycle).not.toHaveBeenCalled()
  })

  it('does not finish an expired waiting head', async () => {
    const current = match({
      status: 'waiting',
      startDate: new Date('2026-01-01T10:00:00.000Z'),
      endDate: new Date('2026-01-01T11:00:00.000Z'),
    })
    const { orchestrator, reconciler } = setup(current)

    await reconciler.reconcile()

    expect(orchestrator.handleMatchFinished).not.toHaveBeenCalled()
    expect(orchestrator.scheduleLifecycle).not.toHaveBeenCalled()
    expect(orchestrator.scheduleFinish).not.toHaveBeenCalled()
  })

  it('does not schedule after dispose while repository read is in flight', async () => {
    let resolveState
    const state = QueueState.createEmpty()
    state.enqueue(match({
      status: 'waiting',
      startDate: new Date('2026-01-01T12:10:00.000Z'),
      endDate: new Date('2026-01-01T13:10:00.000Z'),
    }))
    const repository = { get: () => new Promise((resolve) => { resolveState = resolve }) }
    const orchestrator = {
      scheduleLifecycle: jest.fn(),
      scheduleFinish: jest.fn(),
      cancelForMatch: jest.fn(),
      handleMatchFinished: jest.fn(),
    }
    const reconciler = new LifecycleReconciler({
      repository,
      orchestrator,
      clock: { now: () => new Date('2026-01-01T12:00:00.000Z') },
    })
    const pending = reconciler.reconcile()

    await Promise.resolve()
    const disposing = reconciler.dispose()
    resolveState(state)
    await pending
    await disposing

    expect(orchestrator.scheduleLifecycle).not.toHaveBeenCalled()
    expect(orchestrator.scheduleFinish).not.toHaveBeenCalled()
  })

  it('waits for an in-flight completion before disposal finishes', async () => {
    const current = match({
      status: 'playing',
      startDate: new Date('2026-01-01T10:00:00.000Z'),
      endDate: new Date('2026-01-01T11:00:00.000Z'),
    })
    const completion = Promise.withResolvers ? Promise.withResolvers() : (() => {
      let resolve
      const promise = new Promise((res) => { resolve = res })
      return { promise, resolve }
    })()
    const state = QueueState.createEmpty()
    state.enqueue(current)
    const repository = { get: jest.fn().mockResolvedValue(state) }
    const orchestrator = {
      scheduleLifecycle: jest.fn(),
      scheduleFinish: jest.fn(),
      cancelForMatch: jest.fn(),
      handleMatchFinished: jest.fn(() => completion.promise),
    }
    const reconciler = new LifecycleReconciler({
      repository,
      orchestrator,
      clock: { now: () => new Date('2026-01-01T12:00:00.000Z') },
    })

    const pending = reconciler.reconcile()
    await Promise.resolve()
    await Promise.resolve()
    const disposing = reconciler.dispose()
    let disposed = false
    void disposing.then(() => { disposed = true })
    await Promise.resolve()
    expect(disposed).toBe(false)

    completion.resolve()
    await pending
    await disposing
    expect(disposed).toBe(true)
    expect(orchestrator.handleMatchFinished).toHaveBeenCalledWith(current, { scheduleNext: false })
  })

  it('drains an async task after an orchestrator timer has fired', async () => {
    const current = match({
      status: 'playing',
      startDate: new Date('2026-01-01T11:00:00.000Z'),
      endDate: new Date('2026-01-01T13:00:00.000Z'),
    })
    const state = QueueState.createEmpty()
    state.enqueue(current)
    let disposeTask = null
    let timerCallback
    let resolveTask
    const task = new Promise((resolve) => { resolveTask = resolve })
    const repository = { get: jest.fn().mockResolvedValue(state) }
    const orchestrator = {
      setAsyncTaskHooks: jest.fn(),
      scheduleLifecycle: jest.fn(),
      scheduleFinish: jest.fn(() => {
        timerCallback = () => { disposeTask = task; return task }
      }),
      cancelForMatch: jest.fn(),
      handleMatchFinished: jest.fn(),
      dispose: jest.fn(async () => disposeTask && disposeTask),
    }
    const reconciler = new LifecycleReconciler({
      repository,
      orchestrator,
      clock: { now: () => new Date('2026-01-01T12:00:00.000Z') },
    })

    await reconciler.reconcile()
    const firedTask = timerCallback()
    const disposing = reconciler.dispose()
    let disposed = false
    void disposing.then(() => { disposed = true })
    await Promise.resolve()
    expect(disposed).toBe(false)

    resolveTask()
    await firedTask
    await disposing

    expect(disposed).toBe(true)
    expect(orchestrator.cancelForMatch).toHaveBeenCalledWith(current)
  })
})
