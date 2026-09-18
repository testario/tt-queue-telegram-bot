import { InMemoryPlayersRepository } from '#infrastructure/players/InMemoryPlayersRepository.js'

describe('InMemoryPlayersRepository bans', () => {
  test('preserves the ban when a player is upserted again', async () => {
    const repository = new InMemoryPlayersRepository()
    await repository.upsert({ username: '@alice', userId: 1 })

    expect(await repository.banOne('@alice')).toBe(true)
    await repository.upsert({ username: '@alice', userId: 1, firstName: 'Alice' })

    await expect(repository.findOne('@alice')).resolves.toMatchObject({
      username: '@alice',
      userId: 1,
      banned: true,
    })
  })

  test('bans, unbans, and reports unknown players correctly', async () => {
    const repository = new InMemoryPlayersRepository()
    await repository.upsert({ username: '@alice', userId: 1 })

    await expect(repository.deleteOne('@alice')).resolves.toBe(true)
    await expect(repository.findOne('@alice')).resolves.toMatchObject({ banned: true })
    await expect(repository.unbanOne('@alice')).resolves.toBe(true)
    await expect(repository.findOne('@alice')).resolves.toMatchObject({ banned: false })
    await expect(repository.unbanOne('@missing')).resolves.toBe(false)
  })

  test('keeps the ban when Telegram changes username for the same userId', async () => {
    const repository = new InMemoryPlayersRepository()
    await repository.upsert({ username: '@old', userId: 42 })
    await repository.banOne('@old')

    await repository.upsert({ username: '@new', userId: 42, firstName: 'New' })

    await expect(repository.findOne('@old')).resolves.toBeNull()
    await expect(repository.findByUserId(42)).resolves.toMatchObject({
      username: '@new',
      banned: true,
    })
    await expect(repository.isBanned(42)).resolves.toBe(true)
  })

  test('allows a new userId to reuse a username without inheriting the old ban', async () => {
    const repository = new InMemoryPlayersRepository()
    await repository.upsert({ username: '@old', userId: 42 })
    await repository.upsert({ username: '@new', userId: 42 })

    await repository.upsert({ username: '@old', userId: 99 })
    await expect(repository.findOne('@old')).resolves.toMatchObject({ userId: 99, banned: false })
    await expect(repository.findByUserId(42)).resolves.toMatchObject({ username: '@new' })
  })

  test('increments the username identity version when ownership is transferred', async () => {
    const repository = new InMemoryPlayersRepository()
    await repository.upsert({ username: '@old', userId: 42 })
    const firstVersion = (await repository.findOne('@old')).identityVersion

    await repository.upsert({ username: '@new', userId: 42 })
    await repository.upsert({ username: '@old', userId: 99 })

    await expect(repository.findOne('@old')).resolves.toMatchObject({
      userId: 99,
      identityVersion: firstVersion + 1,
    })
  })

  test('does not let a lower claim generation overwrite a newer one', async () => {
    const repository = new InMemoryPlayersRepository()
    await expect(repository.claimIdentity({ username: '@alice', userId: 7, generation: 2 })).resolves.toEqual({ ok: true })
    await expect(repository.claimIdentity({ username: '@alice', userId: 8, generation: 1 })).resolves.toEqual({ ok: false })
    await expect(repository.findOne('@alice')).resolves.toMatchObject({ userId: 7, generation: 2 })
  })

  test('does not expose synthetic former usernames from findAll', async () => {
    const repository = new InMemoryPlayersRepository()
    repository.players.set('@__former_42', {
      username: '@__former_42',
      lastSeenAt: new Date(),
      banned: true,
    })
    await repository.upsert({ username: '@alice', userId: 1 })

    await expect(repository.findAll()).resolves.toEqual([
      expect.objectContaining({ username: '@alice' }),
    ])
  })
})
