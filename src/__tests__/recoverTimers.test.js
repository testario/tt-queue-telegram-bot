import { jest } from '@jest/globals'
import { recoverTimers } from '#infrastructure/timers/recoverTimers.js'
import { QueueState } from '#domain/entities/QueueState.js'

const createMatch = (status, endDate) => ({
  player1: '@alice',
  player2: '@bob',
  status,
  startDate: new Date('2026-01-01T10:00:00.000Z'),
  endDate,
})

describe('recoverTimers', () => {
  const now = new Date('2026-01-01T12:00:00.000Z')

  const setup = (current) => {
    const state = QueueState.createEmpty()
    state.enqueue(current)
    return {
      repository: { get: jest.fn().mockResolvedValue(state) },
      orchestrator: {
        scheduleLifecycle: jest.fn(),
        scheduleFinish: jest.fn(),
        handleMatchFinished: jest.fn(),
      },
      clock: { now: () => now },
    }
  }

  test('does not finish or schedule an expired waiting head on restart', async () => {
    const deps = setup(createMatch('waiting', new Date('2026-01-01T11:00:00.000Z')))

    await recoverTimers(deps)

    expect(deps.orchestrator.handleMatchFinished).not.toHaveBeenCalled()
    expect(deps.orchestrator.scheduleLifecycle).not.toHaveBeenCalled()
    expect(deps.orchestrator.scheduleFinish).not.toHaveBeenCalled()
  })

  test('finishes an expired playing head on restart', async () => {
    const deps = setup(createMatch('playing', new Date('2026-01-01T11:00:00.000Z')))

    await recoverTimers(deps)

    expect(deps.orchestrator.handleMatchFinished).toHaveBeenCalledTimes(1)
  })
})
