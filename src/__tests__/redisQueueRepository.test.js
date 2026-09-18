import { describe, it, expect, beforeEach } from '@jest/globals'
import RedisMock from 'ioredis-mock'
import { RedisQueueRepository } from '#infrastructure/repositories/RedisQueueRepository.js'
import { QueueState } from '#domain/entities/QueueState.js'

describe('RedisQueueRepository', () => {
  let client, repo
  const searchingState = (username) => {
    const identity = { username, userId: `user:${username}`, generation: 1, status: 'active' }
    return new QueueState({
      searching: [username],
      searchingIdentities: { [username]: identity },
      ownership: { [username]: { ...identity } },
    })
  }

  beforeEach(async () => {
    client = new RedisMock()
    await client.flushall()
    repo = new RedisQueueRepository({ client })
  })

  it('возвращает пустое состояние если ключ не существует', async () => {
    const state = await repo.get()
    expect(state).toBeInstanceOf(QueueState)
    expect(state.queue).toHaveLength(0)
  })

  it('сохраняет и восстанавливает состояние', async () => {
    const state = searchingState('@player1')
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

  it('читает revision и сохраняет его атомарно вместе с состоянием', async () => {
    const initial = await repo.getVersioned()
    const state = searchingState('@player1')

    await repo.save(state)

    expect(initial.revision).toBe(0)
    expect((await repo.getVersioned()).revision).toBe(1)
  })

  it('отклоняет stale CAS и сохраняет unrelated changes', async () => {
    const first = searchingState('@first')
    await repo.save(first)
    const versioned = await repo.getVersioned()

    const changed = searchingState('@second')
    await repo.save(changed)

    expect(await repo.saveIfRevision(versioned.revision, QueueState.createEmpty())).toBe(false)
    expect((await repo.get()).searching).toEqual(['@second'])
  })

  it('считает legacy state версией 0', async () => {
    const state = searchingState('@legacy')
    await client.set('queue:state', JSON.stringify(state))

    const versioned = await repo.getVersioned()
    expect(versioned.revision).toBe(0)
    expect(versioned.state.searching).toEqual(['@legacy'])
  })
})
