import { TournamentFeature } from '#application/features/tournament/TournamentFeature.js'
import { RedisTournamentStore } from '#infrastructure/tournament/RedisTournamentStore.js'

describe('RedisTournamentStore', () => {
  test('делает режим общим для независимых экземпляров фичи', async () => {
    const enabledChats = new Set()
    const client = {
      hexists: async (_key, chatId) => enabledChats.has(chatId) ? 1 : 0,
      hset: async (_key, chatId) => {
        if (enabledChats.has(chatId)) return 0
        enabledChats.add(chatId)
        return 1
      },
      hdel: async (_key, chatId) => enabledChats.delete(chatId) ? 1 : 0,
    }
    const store = new RedisTournamentStore({ client })
    const backendFeature = new TournamentFeature({ stateStore: store })
    const botFeature = new TournamentFeature({ stateStore: store })

    await expect(backendFeature.enable('chat')).resolves.toBe(true)
    await expect(botFeature.isEnabled('chat')).resolves.toBe(true)
    await expect(botFeature.disable('chat')).resolves.toBe(true)
    await expect(backendFeature.isEnabled('chat')).resolves.toBe(false)
  })
})
