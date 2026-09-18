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

const hasIdentity = (identity, requireGeneration = false) => Boolean(
  identity?.username && identity.userId !== undefined && identity.userId !== null
  && (!requireGeneration || Number.isSafeInteger(Number(identity.generation)))
)

const isVerifiableInvite = (invite) => hasIdentity(invite?.playerIdentity, true)
  && hasIdentity(invite?.opponentIdentity, true)
  && ![invite?.player, invite?.opponent, invite?.playerIdentity?.username, invite?.opponentIdentity?.username]
    .some((username) => /^@__former_/.test(username || ''))

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

  _isVerifiable(invite) {
    if (isVerifiableInvite(invite)) return true
    if (invite?.inviteId) this._purge(invite.inviteId)
    return false
  }

  async create(input, opponent, createdAt = this._now()) {
    const { player, opponent: target, createdAt: timestamp = createdAt } =
      normalizeCreateArgs(input, opponent, createdAt)
    if (!player || !target) return null
    if (!hasIdentity(input?.playerIdentity, true) || !hasIdentity(input?.opponentIdentity, true)) return null
    const playerIdentity = input.playerIdentity
    const opponentIdentity = input.opponentIdentity

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
      playerIdentity: { ...playerIdentity, username: player },
      opponentIdentity: { ...opponentIdentity, username: target },
      playerUserId: playerIdentity.userId,
      opponentUserId: opponentIdentity.userId,
    }
    if (input && typeof input === 'object') {
      if (input.playerUserId !== undefined && input.playerUserId !== null) invite.playerUserId = input.playerUserId
      if (input.opponentUserId !== undefined && input.opponentUserId !== null) invite.opponentUserId = input.opponentUserId
    }
    this._byId.set(inviteId, invite)
    this._byPlayer.set(player, inviteId)
    return invite
  }

  async getByPlayer(player) {
    const inviteId = this._byPlayer.get(player)
    if (!inviteId) return null
    const invite = this._byId.get(inviteId) ?? null
    if (!invite || this._isExpired(invite) || !this._isVerifiable(invite)) {
      this._purge(inviteId)
      return null
    }
    return invite
  }

  async getById(inviteId) {
    const invite = this._byId.get(inviteId) ?? null
    if (!invite || this._isExpired(invite) || !this._isVerifiable(invite)) {
      if (invite) this._purge(inviteId)
      return null
    }
    return invite
  }

  async getAll() {
    const live = []
    const expiredIds = []
    for (const invite of this._byId.values()) {
      if (this._isExpired(invite) || !isVerifiableInvite(invite)) expiredIds.push(invite.inviteId)
      else live.push(invite)
    }
    expiredIds.forEach((inviteId) => this._purge(inviteId))
    return live
  }

  async consume(inviteId, actorOrOptions, role) {
    const { actor, role: inviteRole, actorUserId } = normalizeConsumeArgs(inviteId, actorOrOptions, role)
    const invite = this._byId.get(inviteId)
    if (!invite) return null

    if (this._isExpired(invite)) {
      this._purge(inviteId)
      return null
    }

    if (!this._isVerifiable(invite)) return null
    const identity = inviteRole === 'initiator' ? invite.playerIdentity : invite.opponentIdentity
    const expectedActor = identity.username
    if (actorUserId !== undefined && actorUserId !== null
      && String(identity.userId) !== String(actorUserId)) return null
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

  async deleteById(inviteId) {
    const invite = this._byId.get(inviteId) ?? null
    if (!invite) return false
    this._purge(inviteId)
    return true
  }

  async deleteByParticipant(player) {
    const options = player && typeof player === 'object' && !Array.isArray(player) ? player : {}
    const userIds = new Set((options.userIds || []).map(String))
    const identities = options.identities || []
    const invites = await this.getAll()
    const affected = invites.filter((invite) => {
      const identityMatches = identities.some((identity) =>
        [invite.playerIdentity, invite.opponentIdentity].some((participant) =>
          participant?.username === identity?.username
          && String(participant?.userId) === String(identity?.userId)
          && Number(participant?.generation) === Number(identity?.generation)
        )
      )
      if (identities.length > 0) return identityMatches
      const playerMatches = userIds.has(String(invite.playerIdentity?.userId))
      const opponentMatches = userIds.has(String(invite.opponentIdentity?.userId))
      return playerMatches || opponentMatches
    })
    for (const invite of affected) await this.deleteById(invite.inviteId)
    return affected.length
  }

  async clear() {
    this._byId.clear()
    this._byPlayer.clear()
  }
}
