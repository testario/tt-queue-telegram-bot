import { randomBytes } from 'node:crypto'

const INVITE_ID_LENGTH = 16

/** TTL приглашения по умолчанию — 15 минут. */
export const DEFAULT_INVITE_TTL_MS = 15 * 60 * 1000

const createInviteId = () => randomBytes(12).toString('base64url').slice(0, INVITE_ID_LENGTH)

const normalizeCreateArgs = (input, opponent, createdAt) =>
  typeof input === 'object'
    ? input
    : { player: input, opponent, createdAt }

const normalizeConsumeArgs = (inviteId, actorOrOptions, role) =>
  typeof actorOrOptions === 'object'
    ? { inviteId, ...actorOrOptions }
    : { inviteId, actor: actorOrOptions, role }

/**
 * Одноразовое in-memory хранилище прямых приглашений с TTL.
 * Записи без expiresAt (legacy) считаются просроченными.
 */
export class InMemoryInvitesStore {
  /**
   * @param {{ ttlMs?: number, now?: () => number }} [options]
   */
  constructor({ ttlMs = DEFAULT_INVITE_TTL_MS, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs
    this._now = now
    this._byId = new Map()
    this._byPlayer = new Map()
  }

  _isExpired(invite) {
    return !invite?.expiresAt || invite.expiresAt <= this._now()
  }

  _purge(inviteId) {
    const invite = this._byId.get(inviteId)
    this._byId.delete(inviteId)
    if (invite && this._byPlayer.get(invite.player) === inviteId) {
      this._byPlayer.delete(invite.player)
    }
  }

  async create(input, opponent, createdAt = this._now()) {
    const { player, opponent: target, createdAt: timestamp = createdAt } =
      normalizeCreateArgs(input, opponent, createdAt)
    if (!player || !target) return null

    const existingId = this._byPlayer.get(player)
    if (existingId) {
      const existing = this._byId.get(existingId) ?? null
      if (existing && !this._isExpired(existing)) return null
      if (existing) this._purge(existingId)
      else this._byPlayer.delete(player)
    }

    let inviteId = createInviteId()
    while (this._byId.has(inviteId)) inviteId = createInviteId()

    const invite = {
      inviteId,
      player,
      opponent: target,
      createdAt: timestamp,
      expiresAt: timestamp + this.ttlMs,
    }
    this._byId.set(inviteId, invite)
    this._byPlayer.set(player, inviteId)
    return invite
  }

  async getByPlayer(player) {
    const inviteId = this._byPlayer.get(player)
    if (!inviteId) return null
    const invite = this._byId.get(inviteId) ?? null
    if (!invite || this._isExpired(invite)) {
      this._purge(inviteId)
      return null
    }
    return invite
  }

  async getAll() {
    const live = []
    const expiredIds = []
    for (const invite of this._byId.values()) {
      if (this._isExpired(invite)) expiredIds.push(invite.inviteId)
      else live.push(invite)
    }
    expiredIds.forEach((inviteId) => this._purge(inviteId))
    return live
  }

  async consume(inviteId, actorOrOptions, role) {
    const { actor, role: inviteRole } = normalizeConsumeArgs(inviteId, actorOrOptions, role)
    const invite = this._byId.get(inviteId)
    if (!invite) return null

    if (this._isExpired(invite)) {
      this._purge(inviteId)
      return null
    }

    const expectedActor = inviteRole === 'initiator' ? invite.player : invite.opponent
    if (!['initiator', 'opponent'].includes(inviteRole) || expectedActor !== actor) return null

    this._purge(inviteId)
    return invite
  }

  async deleteByPlayer(player) {
    const inviteId = this._byPlayer.get(player)
    if (!inviteId) return null
    const invite = this._byId.get(inviteId) ?? null
    this._byPlayer.delete(player)
    this._byId.delete(inviteId)
    return invite
  }

  async clear() {
    this._byId.clear()
    this._byPlayer.clear()
  }
}
