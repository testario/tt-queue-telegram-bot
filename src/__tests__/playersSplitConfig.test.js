import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd())

describe('split players storage configuration', () => {
  for (const fileName of ['docker-compose.yml', 'docker-compose.vps-dev.yml']) {
    test(`${fileName} gives bot and backend the same Mongo players storage`, () => {
      const compose = readFileSync(resolve(root, fileName), 'utf8')

      expect(compose).toMatch(/bot:[\s\S]*?PLAYERS_MONGODB_URI: mongodb:\/\/mongodb:27017/)
      expect(compose).toMatch(/bot:[\s\S]*?PLAYERS_MONGODB_DB: tt-queue-bot/)
      expect(compose).toMatch(/bot:[\s\S]*?PLAYERS_MONGODB_COLLECTION: players/)
      expect(compose).toMatch(/bot:[\s\S]*?mongodb:\n\s+condition: service_healthy/)
      expect(compose).toMatch(/backend:[\s\S]*?PLAYERS_MONGODB_URI: mongodb:\/\/mongodb:27017/)
      expect(compose).toMatch(/backend:[\s\S]*?PLAYERS_MONGODB_DB: tt-queue-bot/)
      expect(compose).toMatch(/backend:[\s\S]*?PLAYERS_MONGODB_COLLECTION: players/)
    })
  }
})
