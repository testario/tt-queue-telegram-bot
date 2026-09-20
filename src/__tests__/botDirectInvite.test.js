import { jest } from '@jest/globals'
import { InMemoryQueueRepository } from '#infrastructure/repositories/InMemoryQueueRepository.js'
import { InMemoryInvitesStore } from '#infrastructure/invites/InMemoryInvitesStore.js'
import { QueueState } from '#domain/entities/QueueState.js'

const instances = []

class FakeTelegramApi {
  constructor() {
    this.textHandlers = []
    this.eventHandlers = new Map()
    this.sendMessage = jest.fn().mockResolvedValue(undefined)
    this.editMessageText = jest.fn().mockResolvedValue(undefined)
    this.deleteMessage = jest.fn().mockResolvedValue(undefined)
    this.setMyCommands = jest.fn().mockResolvedValue(undefined)
    this.stopPolling = jest.fn().mockResolvedValue(undefined)
    this.answerCallbackQuery = jest.fn().mockResolvedValue(undefined)
    this.getChatMember = jest.fn().mockResolvedValue({ status: 'administrator' })
    instances.push(this)
  }

  onText(pattern, handler) {
    this.textHandlers.push({ pattern, handler })
  }

  on(event, handler) {
    this.eventHandlers.set(event, handler)
  }
}

jest.unstable_mockModule('node-telegram-bot-api', () => ({ default: FakeTelegramApi }))

const { createBot } = await import('#interfaces/telegram/bot.js')

describe('bot /play direct invite guard', () => {
  const previousChatId = process.env.TG_CHAT_ID

  beforeEach(() => {
    process.env.TG_CHAT_ID = 'queue'
    instances.length = 0
  })

  afterAll(() => {
    if (previousChatId === undefined) delete process.env.TG_CHAT_ID
    else process.env.TG_CHAT_ID = previousChatId
  })

  // Тот же guard, что и в webapp POST /api/direct: приглашать нельзя того,
  // у кого уже есть собственное исходящее приглашение — иначе если он примет
  // наше, его приглашение осиротеет. Оба пути (Telegram /play и мини-апп)
  // пишут в одно invitesStore, поэтому дыра должна быть закрыта в обоих.
  test('rejects /play when the target already has their own pending invite', async () => {
    const invitesStore = new InMemoryInvitesStore()
    const repository = new InMemoryQueueRepository(new QueueState({
      ownership: {
        '@bob': { userId: 2, generation: 1, status: 'active' },
        '@dave': { userId: 4, generation: 1, status: 'active' },
        '@alice': { userId: 10, generation: 1, status: 'active' },
      },
    }))
    createBot('token', {
      queueRepository: repository,
      invitesStore,
      autoStartPolling: false,
    })
    const fakeBot = instances[0]
    const { pattern, handler } = fakeBot.textHandlers.find(({ pattern }) => pattern.test('/play @dave'))

    // bob уже пригласил dave — у bob есть своё исходящее приглашение.
    await handler(
      { chat: { id: 'queue' }, from: { id: 2, username: 'bob' }, message_id: 1 },
      pattern.exec('/play @dave')
    )
    expect(await invitesStore.getAll()).toHaveLength(1)
    fakeBot.sendMessage.mockClear()

    // alice пытается позвать bob напрямую — если разрешить, приглашение bob→dave осиротеет.
    await handler(
      { chat: { id: 'queue' }, from: { id: 10, username: 'alice' }, message_id: 2 },
      pattern.exec('/play @bob')
    )

    expect(fakeBot.sendMessage).toHaveBeenCalledTimes(1)
    expect(fakeBot.sendMessage.mock.calls[0][0]).toBe('queue')
    expect(fakeBot.sendMessage.mock.calls[0][1]).toContain('@bob')
    const invites = await invitesStore.getAll()
    expect(invites).toHaveLength(1)
    expect(invites[0]).toEqual(expect.objectContaining({ player: '@bob', opponent: '@dave' }))
  })
})
