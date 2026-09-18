export const getPlayersMongoConfig = (env = process.env) => {
  const uri = env.PLAYERS_MONGODB_URI || env.MONGODB_URI || null

  if (!uri && env.NODE_ENV === 'production') {
    throw new Error('PLAYERS_MONGODB_URI обязателен для players-хранилища в production')
  }

  return {
    uri,
    dbName: env.PLAYERS_MONGODB_DB || env.MONGODB_DB || 'tt-queue-bot',
    collectionName: env.PLAYERS_MONGODB_COLLECTION || 'players',
  }
}
