import { jest } from '@jest/globals'
import { MongoPlayersRepository } from '#infrastructure/players/MongoPlayersRepository.js'

describe('MongoPlayersRepository', () => {
  it('closes the client idempotently, including concurrent calls', async () => {
    const repository = new MongoPlayersRepository({
      uri: 'mongodb://unused',
      dbName: 'test',
    })
    const client = { close: jest.fn().mockResolvedValue(undefined) }
    repository.client = client
    repository.collection = {}

    await Promise.all([repository.close(), repository.close()])
    await repository.close()

    expect(client.close).toHaveBeenCalledTimes(1)
    expect(repository.client).toBeNull()
    expect(repository.collection).toBeNull()
  })

  it('does not overwrite the ban during upsert and changes it without deleting the document', async () => {
    const updateOne = jest.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValue({ matchedCount: 1 })
    const repository = new MongoPlayersRepository({ uri: 'mongodb://unused', dbName: 'test' })
    repository.collection = { updateOne, findOne: jest.fn().mockResolvedValue(null) }

    await repository.upsert({ username: '@alice', userId: 1 })
    expect(updateOne.mock.calls[0][1].$set).not.toHaveProperty('banned')

    await expect(repository.deleteOne('@alice')).resolves.toBe(true)
    await expect(repository.unbanOne('@alice')).resolves.toBe(true)
    expect(updateOne.mock.calls[1]).toEqual([
      { username: '@alice' },
      { $set: { banned: true } },
    ])
    expect(updateOne.mock.calls[2]).toEqual([
      { username: '@alice' },
      { $set: { banned: false } },
    ])
  })

  it('finds the same banned player by stable userId after a username change', async () => {
    const repository = new MongoPlayersRepository({ uri: 'mongodb://unused', dbName: 'test' })
    const findOne = jest.fn()
      .mockResolvedValueOnce({ _id: 'player-id', userId: 42, username: '@old', banned: true })
      .mockResolvedValueOnce({ _id: 'player-id', userId: 42, username: '@new', banned: true })
      .mockResolvedValueOnce({ _id: 'player-id', userId: 42, username: '@new', banned: true })
    const updateOne = jest.fn().mockResolvedValue({})
    repository.collection = { findOne, updateOne }

    await repository.upsert({ username: '@new', userId: 42, firstName: 'New' })

    expect(findOne).toHaveBeenNthCalledWith(1, { userId: 42 })
    expect(updateOne).toHaveBeenCalledWith(
      { _id: 'player-id' },
      expect.objectContaining({ $set: expect.objectContaining({ username: '@new', userId: 42 }) }),
      { upsert: true }
    )
    await expect(repository.isBanned(42)).resolves.toBe(true)
  })

  it('coerces a numeric-string userId to a number when looking up by userId', async () => {
    // userId is stored as a Number (upsert writes it straight from
    // req.tgUser.id). Mongo's equality match is type-strict, so a caller
    // passing the Fastify route-param string ('999') would otherwise never
    // find the document — this is exactly what breaks DELETE
    // /api/players/by-id/:userId in production without this coercion.
    const repository = new MongoPlayersRepository({ uri: 'mongodb://unused', dbName: 'test' })
    const findOne = jest.fn().mockResolvedValue({ userId: 999, username: '@spammer' })
    repository.collection = { findOne }

    await expect(repository.findByUserId('999')).resolves.toEqual({ userId: 999, username: '@spammer' })

    expect(findOne).toHaveBeenCalledWith({ userId: 999 }, { projection: { _id: 0 } })
  })

  it('looks up current usernames through the aliases field', async () => {
    const repository = new MongoPlayersRepository({ uri: 'mongodb://unused', dbName: 'test' })
    repository.collection = {
      findOne: jest.fn().mockImplementation((query) =>
        query.username === '@new'
          ? { username: '@new', usernames: ['@old'], userId: 42 }
          : null
      ),
    }

    await expect(repository.findOne('@old')).resolves.toBeNull()
    await expect(repository.getAliases('@new')).resolves.toEqual(['@new', '@old'])
  })

  it('filters synthetic former usernames from current lookups and lists', async () => {
    const repository = new MongoPlayersRepository({ uri: 'mongodb://unused', dbName: 'test' })
    const toArray = jest.fn().mockResolvedValue([])
    const sort = jest.fn(() => ({ toArray }))
    repository.collection = {
      find: jest.fn(() => ({ sort })),
      findOne: jest.fn(),
    }

    await expect(repository.findOne('@__former_42')).resolves.toBeNull()
    await expect(repository.findAll()).resolves.toEqual([])
    expect(repository.collection.find).toHaveBeenCalledWith(
      { username: { $not: /^@__former_/ } },
      expect.any(Object)
    )
  })

  it('includes verified in the findAll projection', async () => {
    // Regression guard: findAll() uses an explicit field allow-list, so a
    // field missing from it silently disappears from GET /api/players even
    // after being written to Mongo — this caught exactly that bug once.
    const repository = new MongoPlayersRepository({ uri: 'mongodb://unused', dbName: 'test' })
    const toArray = jest.fn().mockResolvedValue([{ username: '@alice', verified: true }])
    const sort = jest.fn(() => ({ toArray }))
    repository.collection = { find: jest.fn(() => ({ sort })) }

    await expect(repository.findAll()).resolves.toEqual([{ username: '@alice', verified: true }])
    expect(repository.collection.find).toHaveBeenCalledWith(
      expect.any(Object),
      { projection: expect.objectContaining({ verified: 1 }) }
    )
  })

  it('does not overwrite verification during upsert and changes it without deleting the document', async () => {
    const updateOne = jest.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ matchedCount: 1 })
      .mockResolvedValueOnce({ matchedCount: 1 })
      .mockResolvedValueOnce({ matchedCount: 0 })
    const repository = new MongoPlayersRepository({ uri: 'mongodb://unused', dbName: 'test' })
    repository.collection = { updateOne, findOne: jest.fn().mockResolvedValue(null) }

    await repository.upsert({ username: '@alice', userId: 1 })
    expect(updateOne.mock.calls[0][1].$set).not.toHaveProperty('verified')

    await expect(repository.setVerified('@alice', true)).resolves.toBe(true)
    expect(updateOne.mock.calls[1]).toEqual([
      { username: '@alice' },
      { $set: { verified: true } },
    ])
    await expect(repository.setVerified('@alice', false)).resolves.toBe(true)
    expect(updateOne.mock.calls[2]).toEqual([
      { username: '@alice' },
      { $set: { verified: false } },
    ])
    await expect(repository.setVerified('@missing', true)).resolves.toBe(false)
  })

  it('reports verified/unverified for a player looked up by userId or @username', async () => {
    const repository = new MongoPlayersRepository({ uri: 'mongodb://unused', dbName: 'test' })
    const findOne = jest.fn()
      .mockResolvedValueOnce({ _id: 'x' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ username: '@alice', verified: true })
    repository.collection = { findOne }

    await expect(repository.isVerified(42)).resolves.toBe(true)
    await expect(repository.isVerified(43)).resolves.toBe(false)
    await expect(repository.isVerified('@alice')).resolves.toBe(true)
    await expect(repository.isVerified(null)).resolves.toBe(false)
    expect(findOne).toHaveBeenNthCalledWith(1, { userId: 42, verified: true }, { projection: { _id: 1 } })
  })

  it('creates a separate unbanned record when a new userId reuses a username', async () => {
    const repository = new MongoPlayersRepository({ uri: 'mongodb://unused', dbName: 'test' })
    const updateOne = jest.fn().mockResolvedValue({})
    repository.collection = {
      findOne: jest.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ _id: 'old-id', userId: 42, username: '@old', banned: true }),
      updateOne,
    }

    await repository.upsert({ username: '@old', userId: 99 })

    expect(updateOne.mock.calls[0][1]).toEqual({
      $set: { username: expect.stringContaining('@__former_42') },
      $addToSet: { usernames: '@old' },
    })
    expect(updateOne.mock.calls[1][1].$set).toMatchObject({ username: '@old', userId: 99 })
    expect(updateOne.mock.calls[1][1].$set).not.toHaveProperty('banned')
  })

  it('rejects a claim with a lower generation without updating the player', async () => {
    const updateOne = jest.fn()
    const repository = new MongoPlayersRepository({ uri: 'mongodb://unused', dbName: 'test' })
    repository.collection = {
      findOne: jest.fn().mockImplementation((query) =>
        query.username === '@alice' ? { _id: 'alice-id', username: '@alice', userId: 7, generation: 2 } : null
      ),
      updateOne,
    }

    await expect(repository.claimIdentity({ username: '@alice', userId: 8, generation: 1 }))
      .resolves.toEqual({ ok: false })
    expect(updateOne).not.toHaveBeenCalled()
  })

  it('deterministically normalizes legacy generations and duplicate renamed users', async () => {
    const documents = [
      {
        _id: 'alice-current',
        username: '@alice',
        userId: 7,
        lastSeenAt: new Date('2026-01-02T00:00:00Z'),
      },
      {
        _id: 'alice-former',
        username: '@__former_7',
        userId: 7,
        usernames: ['@old'],
        banned: true,
        lastSeenAt: new Date('2026-01-01T00:00:00Z'),
      },
      { _id: 'bob', username: '@bob', userId: 8 },
    ]
    const repository = new MongoPlayersRepository({ uri: 'mongodb://unused', dbName: 'test' })
    repository.collection = {
      find: jest.fn(() => ({ toArray: jest.fn(async () => documents) })),
      updateOne: jest.fn(async ({ _id }, update) => {
        const document = documents.find((candidate) => candidate._id === _id)
        Object.assign(document, update.$set)
        return { matchedCount: 1 }
      }),
      deleteOne: jest.fn(async ({ _id }) => {
        const index = documents.findIndex((candidate) => candidate._id === _id)
        if (index > -1) documents.splice(index, 1)
        return { deletedCount: index > -1 ? 1 : 0 }
      }),
    }

    await repository.migrateIdentityGenerations()
    const firstResult = documents.map(({ _id, ...document }) => ({ _id, ...document }))
    await repository.migrateIdentityGenerations()
    const secondResult = documents.map(({ _id, ...document }) => ({ _id, ...document }))

    expect(secondResult).toEqual(firstResult)
    expect(documents).toEqual([
      expect.objectContaining({
        _id: 'alice-current',
        username: '@alice',
        usernames: ['@old'],
        generation: 1,
        identityVersion: 1,
        banned: true,
      }),
      expect.objectContaining({
        _id: 'bob',
        username: '@bob',
        generation: 2,
        identityVersion: 2,
      }),
    ])
    expect(documents.some(({ username }) => username.startsWith('@__former_'))).toBe(false)
  })

  it('merges the primary before deletion and preserves data when duplicate deletion fails', async () => {
    const documents = [
      { _id: 'primary', username: '@alice', userId: 7 },
      { _id: 'duplicate', username: '@old', userId: 7, usernames: ['@older'], banned: true },
    ]
    const repository = new MongoPlayersRepository({ uri: 'mongodb://unused', dbName: 'test' })
    repository.collection = {
      find: jest.fn(() => ({ toArray: jest.fn(async () => documents) })),
      updateOne: jest.fn(async ({ _id }, update) => {
        Object.assign(documents.find((document) => document._id === _id), update.$set)
        return { matchedCount: 1 }
      }),
      deleteOne: jest.fn().mockRejectedValue(new Error('disk failure')),
    }

    await expect(repository.migrateIdentityGenerations()).rejects.toThrow('disk failure')
    expect(documents).toEqual([
      expect.objectContaining({
        _id: 'primary',
        username: '@alice',
        usernames: ['@old', '@older'],
        banned: true,
        generation: 1,
        identityVersion: 1,
      }),
      expect.objectContaining({ _id: 'duplicate', username: '@old', banned: true }),
    ])
  })

  it('retries the unique userId index after normalization and removes an old lookup index', async () => {
    const repository = new MongoPlayersRepository({ uri: 'mongodb://unused', dbName: 'test' })
    const createIndex = jest.fn()
      .mockRejectedValueOnce(new Error('duplicate key'))
      .mockResolvedValueOnce('players_userId_unique')
    repository.collection = {
      createIndex,
      listIndexes: jest.fn(() => ({
        toArray: jest.fn().mockResolvedValue([
          { name: '_id_', key: { _id: 1 }, unique: true },
          { name: 'players_userId_lookup', key: { userId: 1 } },
        ]),
      })),
      dropIndex: jest.fn().mockResolvedValue(undefined),
    }
    repository.migrateIdentityGenerations = jest.fn().mockResolvedValue(1)

    await expect(repository.ensureUniqueUserIdIndex()).resolves.toBeUndefined()
    expect(repository.migrateIdentityGenerations).toHaveBeenCalledTimes(1)
    expect(repository.collection.dropIndex).toHaveBeenCalledWith('players_userId_lookup')
    expect(createIndex).toHaveBeenCalledTimes(2)
    expect(createIndex).toHaveBeenLastCalledWith(
      { userId: 1 },
      { unique: true, sparse: true }
    )
  })

  it('fails closed when userId uniqueness cannot be established', async () => {
    const repository = new MongoPlayersRepository({ uri: 'mongodb://unused', dbName: 'test' })
    repository.collection = {
      createIndex: jest.fn().mockRejectedValue(new Error('index unavailable')),
      listIndexes: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([]) })),
    }
    repository.migrateIdentityGenerations = jest.fn().mockResolvedValue(0)

    await expect(repository.ensureUniqueUserIdIndex()).rejects.toThrow(
      'Не удалось установить уникальность players.userId после миграции'
    )
    expect(repository.migrateIdentityGenerations).toHaveBeenCalledTimes(1)
  })

  it('unsets multiple explicit null userIds before creating the sparse unique index', async () => {
    const documents = [
      { _id: 'legacy-null-1', username: '@legacy-one', userId: null },
      { _id: 'legacy-null-2', username: '@legacy-two', userId: null },
      { _id: 'valid-player', username: '@valid', userId: 42, generation: 3 },
    ]
    const createIndex = jest.fn().mockResolvedValue('players_userId_unique')
    const repository = new MongoPlayersRepository({ uri: 'mongodb://unused', dbName: 'test' })
    repository.collection = {
      find: jest.fn(() => ({ toArray: jest.fn(async () => documents) })),
      updateOne: jest.fn(async ({ _id }, update) => {
        const document = documents.find((candidate) => candidate._id === _id)
        Object.assign(document, update.$set)
        for (const field of Object.keys(update.$unset || {})) delete document[field]
        return { matchedCount: 1 }
      }),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      createIndex,
    }

    await expect(repository.migrateIdentityGenerations()).resolves.toBe(3)
    await expect(repository.ensureUniqueUserIdIndex()).resolves.toBeUndefined()

    expect(documents[0]).not.toHaveProperty('userId')
    expect(documents[1]).not.toHaveProperty('userId')
    expect(documents[2]).toMatchObject({ userId: 42, generation: 3 })
    expect(createIndex).toHaveBeenCalledWith(
      { userId: 1 },
      { unique: true, sparse: true }
    )
  })
})
