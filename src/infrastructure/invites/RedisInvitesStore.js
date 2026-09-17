import { randomBytes } from 'node:crypto'

const INVITES_KEY = 'queue:invites:v2'
const INVITE_ID_LENGTH = 16
const RECORDS_KEY_SUFFIX = ':records'
const BY_PLAYER_KEY_SUFFIX = ':by_player'
const PLAYERS_KEY_SUFFIX = ':players'
const OPPONENTS_KEY_SUFFIX = ':opponents'
const EXPIRES_KEY_SUFFIX = ':expires'

/** TTL приглашения по умолчанию — 15 минут. */
export const DEFAULT_INVITE_TTL_MS = 15 * 60 * 1000

// ARGV: 1 player, 2 inviteId, 3 json, 4 opponent, 5 nowMs, 6 expiresAt
// Просроченное (или legacy-без expires) приглашение игрока атомарно удаляется
// и не блокирует создание нового.
const CREATE_SCRIPT = `
  local existingId = redis.call('HGET', KEYS[2], ARGV[1])
  if existingId then
    local exp = tonumber(redis.call('HGET', KEYS[5], existingId))
    if exp and exp > tonumber(ARGV[5]) then return 0 end
    redis.call('HDEL', KEYS[1], existingId)
    redis.call('HDEL', KEYS[2], ARGV[1])
    redis.call('HDEL', KEYS[3], existingId)
    redis.call('HDEL', KEYS[4], existingId)
    redis.call('HDEL', KEYS[5], existingId)
  end
  if redis.call('HEXISTS', KEYS[1], ARGV[2]) == 1 then return 2 end
  redis.call('HSET', KEYS[1], ARGV[2], ARGV[3])
  redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
  redis.call('HSET', KEYS[3], ARGV[2], ARGV[1])
  redis.call('HSET', KEYS[4], ARGV[2], ARGV[4])
  redis.call('HSET', KEYS[5], ARGV[2], ARGV[6])
  return 1
`

// ARGV: 1 inviteId, 2 actor, 3 role, 4 nowMs
// Просроченное приглашение считается отсутствующим: индексы очищаются,
// авторизация не выдается и новые приглашения не затрагиваются.
const CONSUME_SCRIPT = `
  local player = redis.call('HGET', KEYS[3], ARGV[1])
  if not player then return {0, ''} end
  local exp = tonumber(redis.call('HGET', KEYS[5], ARGV[1]))
  if not exp or exp <= tonumber(ARGV[4]) then
    redis.call('HDEL', KEYS[1], ARGV[1])
    redis.call('HDEL', KEYS[3], ARGV[1])
    redis.call('HDEL', KEYS[4], ARGV[1])
    redis.call('HDEL', KEYS[5], ARGV[1])
    if redis.call('HGET', KEYS[2], player) == ARGV[1] then
      redis.call('HDEL', KEYS[2], player)
    end
    return {0, ''}
  end
  local expected = player
  if ARGV[3] == 'opponent' then expected = redis.call('HGET', KEYS[4], ARGV[1]) end
  if expected ~= ARGV[2] then return {-1, ''} end
  local raw = redis.call('HGET', KEYS[1], ARGV[1])
  redis.call('HDEL', KEYS[1], ARGV[1])
  redis.call('HDEL', KEYS[3], ARGV[1])
  redis.call('HDEL', KEYS[4], ARGV[1])
  redis.call('HDEL', KEYS[5], ARGV[1])
  if redis.call('HGET', KEYS[2], player) == ARGV[1] then
    redis.call('HDEL', KEYS[2], player)
  end
  return {1, raw or ''}
`

// ARGV: 1 player, 2 nowMs
const GET_BY_PLAYER_SCRIPT = `
  local inviteId = redis.call('HGET', KEYS[2], ARGV[1])
  if not inviteId then return {0, ''} end
  local exp = tonumber(redis.call('HGET', KEYS[5], inviteId))
  if not exp or exp <= tonumber(ARGV[2]) then
    redis.call('HDEL', KEYS[1], inviteId)
    redis.call('HDEL', KEYS[2], ARGV[1])
    redis.call('HDEL', KEYS[3], inviteId)
    redis.call('HDEL', KEYS[4], inviteId)
    redis.call('HDEL', KEYS[5], inviteId)
    return {0, ''}
  end
  local raw = redis.call('HGET', KEYS[1], inviteId)
  if not raw then return {0, ''} end
  return {1, raw}
`

// ARGV: 1 nowMs. Удаляет просроченные записи из всех индексов, возвращает живые записи.
const GET_ALL_SCRIPT = `
  local records = redis.call('HGETALL', KEYS[1])
  local now = tonumber(ARGV[1])
  for i = 1, #records, 2 do
    local inviteId = records[i]
    local exp = tonumber(redis.call('HGET', KEYS[5], inviteId))
    if not exp or exp <= now then
      local player = redis.call('HGET', KEYS[3], inviteId)
      redis.call('HDEL', KEYS[1], inviteId)
      redis.call('HDEL', KEYS[3], inviteId)
      redis.call('HDEL', KEYS[4], inviteId)
      redis.call('HDEL', KEYS[5], inviteId)
      if player and redis.call('HGET', KEYS[2], player) == inviteId then
        redis.call('HDEL', KEYS[2], player)
      end
    end
  end
  return redis.call('HVALS', KEYS[1])
`

const DELETE_BY_PLAYER_SCRIPT = `
  local inviteId = redis.call('HGET', KEYS[2], ARGV[1])
  if not inviteId then return {0, ''} end
  local raw = redis.call('HGET', KEYS[1], inviteId)
  redis.call('HDEL', KEYS[1], inviteId)
  redis.call('HDEL', KEYS[2], ARGV[1])
  redis.call('HDEL', KEYS[3], inviteId)
  redis.call('HDEL', KEYS[4], inviteId)
  redis.call('HDEL', KEYS[5], inviteId)
  return {1, raw or ''}
`

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
 * Атомарное Redis-хранилище одноразовых прямых приглашений с TTL.
 * Записи без expiresAt (legacy) считаются просроченными.
 */
export class RedisInvitesStore {
  /**
   * @param {{ client: object, key?: string, ttlMs?: number, now?: () => number }} deps
   */
  constructor({ client, key = INVITES_KEY, ttlMs = DEFAULT_INVITE_TTL_MS, now = () => Date.now() }) {
    this.client = client
    this.key = key
    this.ttlMs = ttlMs
    this._now = now
    this.recordsKey = `${key}${RECORDS_KEY_SUFFIX}`
    this.byPlayerKey = `${key}${BY_PLAYER_KEY_SUFFIX}`
    this.playersKey = `${key}${PLAYERS_KEY_SUFFIX}`
    this.opponentsKey = `${key}${OPPONENTS_KEY_SUFFIX}`
    this.expiresKey = `${key}${EXPIRES_KEY_SUFFIX}`
  }

  async create(input, opponent, createdAt = this._now()) {
    const { player, opponent: target, createdAt: timestamp = createdAt } =
      normalizeCreateArgs(input, opponent, createdAt)
    if (!player || !target) return null

    const nowMs = this._now()
    const expiresAt = timestamp + this.ttlMs

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const inviteId = createInviteId()
      const invite = { inviteId, player, opponent: target, createdAt: timestamp, expiresAt }
      const result = await this.client.eval(
        CREATE_SCRIPT,
        5,
        this.recordsKey,
        this.byPlayerKey,
        this.playersKey,
        this.opponentsKey,
        this.expiresKey,
        player,
        inviteId,
        JSON.stringify(invite),
        target,
        nowMs,
        expiresAt
      )
      if (Number(result) === 0) return null
      if (Number(result) === 1) return invite
    }

    throw new Error('Не удалось сгенерировать уникальный inviteId')
  }

  async getByPlayer(player) {
    const [status, raw] = await this.client.eval(
      GET_BY_PLAYER_SCRIPT,
      5,
      this.recordsKey,
      this.byPlayerKey,
      this.playersKey,
      this.opponentsKey,
      this.expiresKey,
      player,
      this._now()
    )
    if (Number(status) !== 1) return null
    return JSON.parse(raw)
  }

  async getAll() {
    const raw = await this.client.eval(
      GET_ALL_SCRIPT,
      5,
      this.recordsKey,
      this.byPlayerKey,
      this.playersKey,
      this.opponentsKey,
      this.expiresKey,
      this._now()
    )
    return raw.map((value) => JSON.parse(value))
  }

  async consume(inviteId, actorOrOptions, role) {
    const { actor, role: inviteRole } = normalizeConsumeArgs(inviteId, actorOrOptions, role)
    if (!inviteId || !actor || !['initiator', 'opponent'].includes(inviteRole)) return null

    const result = await this.client.eval(
      CONSUME_SCRIPT,
      5,
      this.recordsKey,
      this.byPlayerKey,
      this.playersKey,
      this.opponentsKey,
      this.expiresKey,
      inviteId,
      actor,
      inviteRole,
      this._now()
    )
    const [status, raw] = result
    if (Number(status) !== 1) return null
    return JSON.parse(raw)
  }

  async deleteByPlayer(player) {
    const result = await this.client.eval(
      DELETE_BY_PLAYER_SCRIPT,
      5,
      this.recordsKey,
      this.byPlayerKey,
      this.playersKey,
      this.opponentsKey,
      this.expiresKey,
      player
    )
    const [status, raw] = result
    return Number(status) === 1 && raw ? JSON.parse(raw) : null
  }

  async clear() {
    await this.client.del(
      this.recordsKey,
      this.byPlayerKey,
      this.playersKey,
      this.opponentsKey,
      this.expiresKey
    )
  }
}
