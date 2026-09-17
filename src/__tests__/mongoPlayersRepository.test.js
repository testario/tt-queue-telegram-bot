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
})
