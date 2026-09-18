import { jest } from '@jest/globals'
import { buildBackendContext } from '#interfaces/webapp/index.js'

const match = {
  player1: '@alice',
  player2: '@bob',
  startDate: new Date('2026-01-01T12:00:00.000Z'),
  endDate: new Date('2026-01-01T13:00:00.000Z'),
  status: 'playing',
}

describe('split-process announcement ownership', () => {
  test('backend creator sends one local announcement and does not subscribe for remote sends', async () => {
    const bot = { sendMessage: jest.fn().mockResolvedValue(undefined) }
    const eventBus = { publish: jest.fn().mockResolvedValue(undefined) }
    const context = buildBackendContext({
      queueRepository: {},
      queueChatId: 'queue',
      messages: { matchCreated: jest.fn(() => 'created') },
      ui: { inline: { confirmNoTime: 'cancel' } },
      bot,
      eventBus,
      log: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
    })

    context.notifier.notify('queue', 'created', { type: 'match_created', match })
    await Promise.resolve()

    expect(bot.sendMessage).toHaveBeenCalledTimes(1)
    expect(eventBus.publish).toHaveBeenCalledTimes(1)
    expect(eventBus.subscribe).toBeUndefined()
  })

  test('relays notifications without a match_created meta, like a match cancellation, to the chat', async () => {
    const bot = { sendMessage: jest.fn().mockResolvedValue(undefined) }
    const context = buildBackendContext({
      queueRepository: {},
      queueChatId: 'queue',
      messages: { matchCreated: jest.fn(() => 'created') },
      ui: { inline: { confirmNoTime: 'cancel' } },
      bot,
      eventBus: null,
      log: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
    })

    // CancelMatch.execute уведомляет чат без meta.type — раньше это молча отбрасывалось.
    context.notifier.notify('queue', 'Игрок @alice отменил запись')
    await Promise.resolve()

    expect(bot.sendMessage).toHaveBeenCalledWith('queue', 'Игрок @alice отменил запись', undefined)
  })

  test('still drops state_update notifications, which carry no user-facing text', async () => {
    const bot = { sendMessage: jest.fn().mockResolvedValue(undefined) }
    const context = buildBackendContext({
      queueRepository: {},
      queueChatId: 'queue',
      messages: { matchCreated: jest.fn(() => 'created') },
      ui: { inline: { confirmNoTime: 'cancel' } },
      bot,
      eventBus: null,
      log: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
    })

    context.notifier.notify('queue', '', { type: 'state_update' })
    await Promise.resolve()

    expect(bot.sendMessage).not.toHaveBeenCalled()
  })

})
