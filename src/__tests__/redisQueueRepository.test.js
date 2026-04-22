import { describe, it, expect, beforeEach } from '@jest/globals'
import RedisMock from 'ioredis-mock'
import { RedisQueueRepository } from '#infrastructure/repositories/RedisQueueRepository.js'
import { QueueState } from '#domain/entities/QueueState.js'

describe('RedisQueueRepository', () => {
  let client, repo

  beforeEach(() => {
    client = new RedisMock()
    repo = new RedisQueueRepository({ client })
  })

  it('возвращает пустое состояние если ключ не существует', async () => {
    const state = await repo.get()
    expect(state).toBeInstanceOf(QueueState)
    expect(state.queue).toHaveLength(0)
  })

  it('сохраняет и восстанавливает состояние', async () => {
    const state = QueueState.createEmpty()
    state.addSearching('@player1')
    await repo.save(state)
    const loaded = await repo.get()
    expect(loaded.searching).toContain('@player1')
  })

  it('восстанавливает даты матчей как Date объекты', async () => {
    const state = QueueState.createEmpty()
    const match = {
      player1: '@a', player2: '@b',
      startDate: new Date(), endDate: new Date(Date.now() + 60000),
      status: 'waiting',
    }
    state.enqueue(match)
    await repo.save(state)
    const loaded = await repo.get()
    expect(loaded.queue[0].startDate).toBeInstanceOf(Date)
    expect(loaded.queue[0].endDate).toBeInstanceOf(Date)
  })
})
