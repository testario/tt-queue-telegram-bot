import { describe, expect, it } from '@jest/globals'
import { createTestIdentityHelper } from '#application/usecases/createTestIdentityHelper.js'
import { RegisterSearch } from '#application/usecases/RegisterSearch.js'
import { QueueService } from '#domain/services/QueueService.js'
import { InMemoryQueueRepository } from '#infrastructure/repositories/InMemoryQueueRepository.js'
import { InMemoryPlayersRepository } from '#infrastructure/players/InMemoryPlayersRepository.js'
import { templates } from '#application/messages/templates.js'

describe('test identity helper', () => {
  it('uses the claim lifecycle and allocates global generations', async () => {
    const queueRepository = new InMemoryQueueRepository()
    const playersRepository = new InMemoryPlayersRepository()
    const activate = createTestIdentityHelper({ queueRepository, playersRepository })

    const alice = await activate({ username: '@alice', userId: 1 })
    const bob = await activate({ username: '@bob', userId: 2 })
    const replacement = await activate({ username: '@alice', userId: 3 })
    const state = await queueRepository.get()

    expect(alice).toMatchObject({ username: '@alice', userId: 1, generation: 1, status: 'active' })
    expect(bob).toMatchObject({ username: '@bob', userId: 2, generation: 2, status: 'active' })
    expect(replacement).toMatchObject({ username: '@alice', userId: 3, generation: 3, status: 'active' })
    expect(state.identityEpoch).toBe(3)
    expect(state.isActiveIdentity(alice)).toBe(false)
    expect(state.isActiveIdentity(replacement)).toBe(true)
  })

  it('returns tokens that strict queue use cases accept', async () => {
    const queueRepository = new InMemoryQueueRepository()
    const playersRepository = new InMemoryPlayersRepository()
    const activate = createTestIdentityHelper({ queueRepository, playersRepository })
    const alice = await activate({ username: 'alice', userId: 1 })
    const registerSearch = new RegisterSearch({
      repository: queueRepository,
      queueService: new QueueService({ readyMs: 0, gameMs: 60_000 }),
      messages: templates,
    })

    await expect(registerSearch.execute('@alice', alice)).resolves.toMatchObject({ status: 'added' })
    await expect(registerSearch.execute('@victim', alice)).resolves.toMatchObject({
      status: 'identity_unavailable',
    })
  })
})
