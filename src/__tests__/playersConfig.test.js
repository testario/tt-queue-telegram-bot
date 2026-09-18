import { getPlayersMongoConfig } from '#infrastructure/players/config.js'

describe('players production configuration', () => {
  test('requires MongoDB for production all-in-one deployments', () => {
    expect(() => getPlayersMongoConfig({ NODE_ENV: 'production' })).toThrow(
      'PLAYERS_MONGODB_URI обязателен'
    )
  })

  test('keeps the in-memory fallback available outside production', () => {
    expect(getPlayersMongoConfig({ NODE_ENV: 'test' })).toMatchObject({ uri: null })
  })
})
