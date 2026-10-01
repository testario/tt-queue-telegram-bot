const TOURNAMENT_ENABLED_KEY = 'queue:tournament:enabled'

/**
 * Durable состояние включенного турнирного режима для нескольких процессов.
 */
class RedisTournamentStore {
  constructor({ client, key = TOURNAMENT_ENABLED_KEY }) {
    this.client = client
    this.key = key
  }

  async isEnabled(chatId) {
    return (await this.client.hexists(this.key, String(chatId))) === 1
  }

  async enable(chatId) {
    return (await this.client.hset(this.key, String(chatId), '1')) === 1
  }

  async disable(chatId) {
    return (await this.client.hdel(this.key, String(chatId))) === 1
  }
}

export { RedisTournamentStore }
