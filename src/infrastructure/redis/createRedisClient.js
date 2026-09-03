import Redis from 'ioredis'
import { createNullLogger } from '#infrastructure/logger/Logger.js'

/**
 * Создаёт и подключает Redis-клиент.
 * @param {{ url: string, logger?: object }} deps
 * @returns {Promise<import('ioredis').Redis>}
 */
export const createRedisClient = async ({ url, logger }) => {
  const log = logger || createNullLogger()
  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
  })
  await client.connect()
  log.info('Подключение к Redis установлено', { url })
  return client
}

/**
 * Создаёт пару клиентов для Pub/Sub.
 * Redis не позволяет использовать один клиент одновременно для PUBLISH и SUBSCRIBE.
 * @param {{ url: string, logger?: object }} deps
 * @returns {Promise<{ publisher: import('ioredis').Redis, subscriber: import('ioredis').Redis }>}
 */
export const createRedisPubSub = async ({ url, logger }) => {
  const log = logger || createNullLogger()
  const publisher = new Redis(url, { lazyConnect: true })
  const subscriber = new Redis(url, { lazyConnect: true })
  await Promise.all([publisher.connect(), subscriber.connect()])
  log.info('Redis Pub/Sub клиенты подключены')
  return { publisher, subscriber }
}
