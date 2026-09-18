import { beforeEach, describe, expect, it } from '@jest/globals'
import RedisMock from 'ioredis-mock'
import { InMemoryInvitesStore } from '#infrastructure/invites/InMemoryInvitesStore.js'
import { RedisInvitesStore } from '#infrastructure/invites/RedisInvitesStore.js'
import { buildDirectInviteKeyboard } from '#interfaces/telegram/keyboards.js'
import { parseCallbackData } from '#application/parsers/callbackData.js'

const ui = {
  inline: {
    directAccept: 'Accept',
    directDecline: 'Decline',
    directCancel: 'Cancel',
  },
}

const TTL_MS = 15 * 60 * 1000

describe.each(['memory', 'redis'])('invite store contract: %s', (kind) => {
  let store
  let nowMs

  const seedLegacyRecord = async (inviteId, record) => {
    if (kind === 'memory') {
      store._byId.set(inviteId, record)
      store._byPlayer.set(record.player, inviteId)
      return
    }
    await store.client.hset(store.recordsKey, inviteId, JSON.stringify(record))
    await store.client.hset(store.byPlayerKey, record.player, inviteId)
    await store.client.hset(store.playersKey, inviteId, record.player)
  }

  beforeEach(() => {
    nowMs = 1_000_000
    const clock = () => nowMs
    store = kind === 'memory'
      ? new InMemoryInvitesStore({ now: clock })
      : new RedisInvitesStore({ client: new RedisMock(), now: clock })
    return store.client?.flushall()
  })

  const createInvite = (input, opponent, createdAt) => {
    const source = typeof input === 'object' ? input : { player: input, opponent, createdAt }
    return store.create({
      ...source,
      playerIdentity: source.playerIdentity || {
        username: source.player,
        userId: `test:${source.player}`,
        generation: 1,
      },
      opponentIdentity: source.opponentIdentity || {
        username: source.opponent,
        userId: `test:${source.opponent}`,
        generation: 1,
      },
    })
  }

  it('creates a cryptographic 16-character invite and prevents overwrite', async () => {
    const invite = await createInvite({ player: '@alice', opponent: '@bob' })
    expect(invite.inviteId).toMatch(/^[A-Za-z0-9_-]{16}$/)
    expect(await createInvite({ player: '@alice', opponent: '@charlie' })).toBeNull()
    expect(await store.getByPlayer('@alice')).toEqual(invite)
  })

  it('persists expiresAt with the default 15-minute TTL', async () => {
    const invite = await createInvite({ player: '@alice', opponent: '@bob' })

    expect(invite.expiresAt).toBe(nowMs + TTL_MS)
  })

  it('requires a generation for both persisted participant identities', async () => {
    const invite = await createInvite({
      player: '@alice',
      opponent: '@bob',
      playerIdentity: { username: '@alice', userId: 1, generation: 1 },
      opponentIdentity: { username: '@bob', userId: 2 },
    })

    expect(invite).toBeNull()
  })

  it('treats an invite as live just before the boundary and expired at it', async () => {
    const invite = await createInvite({ player: '@alice', opponent: '@bob' })

    nowMs = invite.expiresAt - 1
    expect(await store.getByPlayer('@alice')).toEqual(invite)

    nowMs = invite.expiresAt
    expect(await store.consume(invite.inviteId, '@bob', 'opponent')).toBeNull()
    expect(await store.getByPlayer('@alice')).toBeNull()
    expect(await store.getAll()).toEqual([])
  })

  it('allows a new create once the previous invite expired', async () => {
    const expired = await createInvite({ player: '@alice', opponent: '@bob' })
    nowMs = expired.expiresAt + 1

    const fresh = await createInvite({ player: '@alice', opponent: '@charlie' })

    expect(fresh).not.toBeNull()
    expect(fresh.inviteId).not.toBe(expired.inviteId)
    expect(await store.getByPlayer('@alice')).toEqual(fresh)
    expect(await store.getAll()).toEqual([fresh])
  })

  it('does not authorize or remove a newer invite when consuming an expired one', async () => {
    const expired = await createInvite({ player: '@alice', opponent: '@bob' })
    nowMs = expired.expiresAt + 1
    const newer = await createInvite({ player: '@alice', opponent: '@charlie' })

    expect(await store.consume(expired.inviteId, '@bob', 'opponent')).toBeNull()
    expect(await store.getByPlayer('@alice')).toEqual(newer)

    expect(await store.consume(newer.inviteId, '@charlie', 'opponent')).toEqual(newer)
  })

  it('purges an expired invite on consume attempt without touching other invites', async () => {
    const expired = await createInvite({ player: '@alice', opponent: '@bob' })
    nowMs += TTL_MS / 2
    const other = await createInvite({ player: '@carol', opponent: '@dave' })
    nowMs = expired.expiresAt + 1

    expect(await store.consume(expired.inviteId, '@bob', 'opponent')).toBeNull()
    expect(await store.getAll()).toEqual([other])
    expect(await store.getByPlayer('@carol')).toEqual(other)
  })

  it('filters and purges mixed live, expired and legacy records in getAll', async () => {
    const stale = await createInvite({ player: '@alice', opponent: '@bob' })
    nowMs += TTL_MS / 2
    const live = await createInvite({ player: '@carol', opponent: '@dave' })
    await seedLegacyRecord('legacyInviteId1', {
      inviteId: 'legacyInviteId1',
      player: '@legacy',
      opponent: '@ghost',
      createdAt: nowMs - 10_000,
    })
    nowMs = stale.expiresAt + 1

    expect(await store.getAll()).toEqual([live])
    expect(await store.getByPlayer('@alice')).toBeNull()
    expect(await store.getByPlayer('@legacy')).toBeNull()
    expect(await store.getByPlayer('@carol')).toEqual(live)
  })

  it('purges a live invite whose identity token is incomplete', async () => {
    await seedLegacyRecord('incompleteInviteId', {
      inviteId: 'incompleteInviteId',
      player: '@legacy',
      opponent: '@ghost',
      createdAt: nowMs,
      expiresAt: nowMs + TTL_MS,
      playerIdentity: { username: '@legacy', userId: 1, generation: 1 },
      opponentIdentity: { username: '@ghost', userId: 2 },
    })

    expect(await store.getById('incompleteInviteId')).toBeNull()
    expect(await store.getAll()).toEqual([])
  })

  it('purges invites that reference synthetic former usernames', async () => {
    await seedLegacyRecord('formerInviteId', {
      inviteId: 'formerInviteId',
      player: '@__former_42',
      opponent: '@bob',
      createdAt: nowMs,
      expiresAt: nowMs + TTL_MS,
      playerIdentity: { username: '@__former_42', userId: 42, generation: 1 },
      opponentIdentity: { username: '@bob', userId: 2, generation: 1 },
    })

    expect(await store.getAll()).toEqual([])
    expect(await store.getByPlayer('@__former_42')).toBeNull()
  })

  it('consumes an invite once and validates actor role', async () => {
    const invite = await createInvite({ player: '@alice', opponent: '@bob' })
    expect(await store.consume(invite.inviteId, '@mallory', 'opponent')).toBeNull()
    expect(await store.consume(invite.inviteId, '@bob', 'opponent')).toEqual(invite)
    expect(await store.consume(invite.inviteId, '@bob', 'opponent')).toBeNull()
  })

  it('deletes invites for all current and stale username aliases', async () => {
    await createInvite({ player: '@old', opponent: '@bob' })
    const unrelated = await createInvite({ player: '@carol', opponent: '@dave' })

    await expect(store.deleteByParticipant({ userIds: ['test:@old'] })).resolves.toBe(1)
    expect(await store.getAll()).toEqual([unrelated])
  })

  it('deletes only the exact participant snapshot when a newer invite exists', async () => {
    const oldInvite = await createInvite({ player: '@alice', opponent: '@bob' })
    nowMs = oldInvite.expiresAt + 1
    const newerInvite = await createInvite({ player: '@alice', opponent: '@charlie' })
    const getAll = store.getAll.bind(store)
    store.getAll = async () => [oldInvite]

    await expect(store.deleteByParticipant({ userIds: [`test:@alice`] })).resolves.toBe(1)
    store.getAll = getAll
    await expect(store.getById(newerInvite.inviteId)).resolves.toEqual(newerInvite)
  })

  it('allows exactly one parallel terminal consume', async () => {
    const invite = await createInvite({ player: '@alice', opponent: '@bob' })
    const results = await Promise.all(
      Array.from({ length: 8 }, () => store.consume(invite.inviteId, '@bob', 'opponent'))
    )
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await store.getAll()).toEqual([])
  })

  it('honors an injectable ttlMs for deterministic expiry', async () => {
    const shortTtlStore = kind === 'memory'
      ? new InMemoryInvitesStore({ ttlMs: 50, now: () => nowMs })
      : new RedisInvitesStore({ client: new RedisMock(), ttlMs: 50, now: () => nowMs })
    await shortTtlStore.client?.flushall()

    const invite = await shortTtlStore.create({
      player: '@alice',
      opponent: '@bob',
      playerIdentity: { username: '@alice', userId: 1, generation: 1 },
      opponentIdentity: { username: '@bob', userId: 2, generation: 1 },
    })
    expect(invite.expiresAt).toBe(nowMs + 50)

    nowMs += 51
    expect(await shortTtlStore.getByPlayer('@alice')).toBeNull()
    expect(await shortTtlStore.create({
      player: '@alice',
      opponent: '@bob',
      playerIdentity: { username: '@alice', userId: 1, generation: 1 },
      opponentIdentity: { username: '@bob', userId: 2, generation: 1 },
    })).not.toBeNull()
  })

  it('does not delete a newer Redis invite when an expired read races create', async () => {
    if (kind !== 'redis') return
    const expired = await createInvite({ player: '@alice', opponent: '@bob' })
    nowMs = expired.expiresAt + 1
    const originalHget = store.client.hget.bind(store.client)
    let replaced = false
    store.client.hget = async (key, field) => {
      const raw = await originalHget(key, field)
      if (!replaced && key === store.recordsKey && field === expired.inviteId) {
        replaced = true
        await createInvite({ player: '@alice', opponent: '@charlie' })
      }
      return raw
    }

    expect(await store.getById(expired.inviteId)).toBeNull()
    expect(await store.getByPlayer('@alice')).toMatchObject({ opponent: '@charlie' })
  })
})

it('encodes only inviteId in direct callback data and treats legacy data as stale', () => {
  const invite = { inviteId: 'Abcdefgh12345678', player: '@alice', opponent: '@bob' }
  const keyboard = buildDirectInviteKeyboard(invite, ui)
  const callbackData = keyboard.inline_keyboard[0][0].callback_data

  expect(callbackData).toBe(`direct_accept:${invite.inviteId}`)
  expect(callbackData.length).toBeLessThan(64)
  expect(parseCallbackData(callbackData)).toEqual({ type: 'direct_accept', inviteId: invite.inviteId })
  expect(parseCallbackData('direct_accept:@alice,@bob')).toEqual({
    type: 'direct_accept',
    inviteId: null,
  })
})
