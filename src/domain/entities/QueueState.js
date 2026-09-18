/**
 * Состояние очереди и истории матчей.
 *
 * QueueState v2 также хранит Redis-CAS-owned mirror текущего владельца каждого
 * username. Старые поколения остаются tombstone и не могут быть переиспользованы.
 */
class QueueState {
  static SCHEMA_VERSION = 2;

  constructor({
    queue = [],
    played = [],
    playedIdentities = [],
    searching = [],
    searchingUserIds = {},
    searchingIdentities = {},
    schemaVersion = QueueState.SCHEMA_VERSION,
    identityEpoch = 0,
    ownership = {},
    identityTombstones = {},
    bannedUserIds = {},
    lastPlayedResetAt = null,
    holdNextMatch = false,
  } = {}) {
    this.queue = queue;
    this.played = played;
    this.playedIdentities = QueueState.normalizePlayedIdentities(playedIdentities);
    this.searching = searching;
    this.searchingUserIds = { ...searchingUserIds };
    this.searchingIdentities = QueueState.normalizeIdentities(searchingIdentities);
    this.ownership = QueueState.normalizeOwnership(ownership);
    this.identityTombstones = QueueState.normalizeTombstones(identityTombstones);
    this.bannedUserIds = { ...bannedUserIds };
    this.schemaVersion = Number(schemaVersion) || 1;
    this.identityEpoch = Math.max(
      0,
      Number(identityEpoch) || 0,
      ...Object.values(this.ownership).map((identity) => identity.generation),
      ...Object.values(this.identityTombstones).flat().map((identity) => identity.generation),
    );
    this.lastPlayedResetAt = lastPlayedResetAt ? new Date(lastPlayedResetAt) : null;
    this.holdNextMatch = Boolean(holdNextMatch);
    Object.defineProperty(this, "lastIdentityTransitions", {
      value: [],
      writable: true,
      enumerable: false,
    });
  }

  static createEmpty(params = {}) {
    return new QueueState(params);
  }

  static isCompleteIdentity(identity) {
    return Boolean(identity?.username
      && identity.userId !== undefined
      && identity.userId !== null
      && Number.isSafeInteger(Number(identity.generation))
      && Number(identity.generation) >= 1);
  }

  static isV2(raw) {
    return Number(raw?.schemaVersion) === QueueState.SCHEMA_VERSION;
  }

  static isLegacy(raw) {
    return !QueueState.isV2(raw);
  }

  static normalizeOwnership(ownership) {
    return Object.fromEntries(Object.entries(ownership || {}).flatMap(([username, value]) => {
      const generation = Number(value?.generation);
      if (!value || value.userId === undefined || value.userId === null
        || !Number.isSafeInteger(generation) || generation < 1) return [];
      const status = ["pending", "active", "inactive"].includes(value.status)
        ? value.status
        : "inactive";
      return [[username, { userId: value.userId, generation, status }]];
    }));
  }

  static normalizeTombstones(tombstones) {
    return Object.fromEntries(Object.entries(tombstones || {}).map(([username, records]) => [
      username,
      [...new Map((Array.isArray(records) ? records : []).flatMap((record) => {
        const generation = Number(record?.generation);
        if (record?.userId === undefined || record?.userId === null
          || !Number.isSafeInteger(generation) || generation < 1) return [];
        return [[generation, { userId: record.userId, generation, status: "inactive" }]];
      })).values()].sort((a, b) => a.generation - b.generation),
    ]));
  }

  static normalizeIdentities(identities) {
    return Object.fromEntries(Object.entries(identities || {}).flatMap(([username, identity]) => {
      if (!identity || identity.userId === undefined || identity.userId === null
        || !Number.isSafeInteger(Number(identity.generation)) || Number(identity.generation) < 1) return [];
      return [[username, {
        username: identity.username || username,
        userId: identity.userId,
        generation: Number(identity.generation),
        status: identity.status || "active",
      }]];
    }));
  }

  static normalizePlayedIdentities(identities) {
    return (Array.isArray(identities) ? identities : []).filter((identity) =>
      QueueState.isCompleteIdentity(identity)
    ).map((identity) => ({ ...identity }));
  }

  static from(raw) {
    if (!raw) return QueueState.createEmpty();
    const queue = (raw.queue || []).map((item) => ({
      ...item,
      startDate: new Date(item.startDate),
      endDate: new Date(item.endDate),
    }));
    return new QueueState({
      queue,
      played: raw.played || [],
      playedIdentities: raw.playedIdentities || [],
      searching: raw.searching || [],
      searchingUserIds: raw.searchingUserIds || {},
      searchingIdentities: raw.searchingIdentities || {},
      schemaVersion: raw.schemaVersion ?? 1,
      identityEpoch: raw.identityEpoch,
      ownership: raw.ownership,
      identityTombstones: raw.identityTombstones,
      bannedUserIds: raw.bannedUserIds,
      lastPlayedResetAt: raw.lastPlayedResetAt ? new Date(raw.lastPlayedResetAt) : null,
      holdNextMatch: raw.holdNextMatch,
    });
  }

  clone() {
    return QueueState.from({
      queue: this.queue.map((item) => ({
        ...item,
        startDate: item.startDate,
        endDate: item.endDate,
      })),
      played: [...this.played],
      playedIdentities: this.playedIdentities.map((identity) => ({ ...identity })),
      searching: [...this.searching],
      searchingUserIds: { ...this.searchingUserIds },
      searchingIdentities: Object.fromEntries(Object.entries(this.searchingIdentities).map(([username, identity]) => [
        username, { ...identity },
      ])),
      schemaVersion: this.schemaVersion,
      identityEpoch: this.identityEpoch,
      ownership: Object.fromEntries(Object.entries(this.ownership).map(([username, identity]) => [
        username, { ...identity },
      ])),
      identityTombstones: Object.fromEntries(Object.entries(this.identityTombstones).map(([username, records]) => [
        username, records.map((record) => ({ ...record })),
      ])),
      bannedUserIds: Object.fromEntries(Object.entries(this.bannedUserIds).map(([userId, value]) => [
        userId, value && typeof value === "object" ? { ...value } : value,
      ])),
      lastPlayedResetAt: this.lastPlayedResetAt ? new Date(this.lastPlayedResetAt) : null,
      holdNextMatch: this.holdNextMatch,
    });
  }

  hasPlayer(player, identityToken = undefined) {
    return this.isSearching(player, identityToken)
      || this.isQueued(player, identityToken)
      || this.isPlayed(player, identityToken);
  }

  isSearching(player, identityToken = undefined) {
    if (!this.searching.includes(player)) return false;
    if (!identityToken) return true;
    return QueueState.sameIdentity(this.searchingIdentities[player], identityToken)
      && this.searchingIdentities[player].username === identityToken.username;
  }

  isQueued(player, identityToken = undefined) {
    return this.queue.some((match) => {
      const participantNames = [match.player1, match.player2];
      return participantNames.some((participant) => {
        if (participant === player) return !identityToken
          || QueueState.sameUser(match.participantIdentities?.[participant], identityToken);
        return Boolean(identityToken)
          && QueueState.sameUser(match.participantIdentities?.[participant], identityToken);
      });
    });
  }

  isPlayed(player, identityToken = undefined) {
    if (!identityToken) return this.played.includes(player);
    if (this.playedIdentities.length > 0) {
      return this.playedIdentities.some((identity) => QueueState.sameUser(identity, identityToken));
    }
    return this.played.includes(player);
  }

  addSearching(player, identityOrUserId = undefined) {
    if (!QueueState.isCompleteIdentity(identityOrUserId)
      || identityOrUserId.username !== player
      || !this.isActiveIdentity(identityOrUserId, player)) return false;
    if (!this.searching.includes(player)) this.searching.push(player);
    const identity = { ...identityOrUserId };
    this.searchingUserIds[player] = identity.userId;
    this.searchingIdentities[player] = identity;
    return true;
  }

  removeSearching(player, identityToken = undefined) {
    if (!QueueState.isCompleteIdentity(identityToken)
      || identityToken.username !== player
      || !this.isActiveIdentity(identityToken, player)
      || !this.isSearching(player, identityToken)) return false;
    const index = this.searching.indexOf(player);
    if (index > -1) this.searching.splice(index, 1);
    delete this.searchingUserIds[player];
    delete this.searchingIdentities[player];
    return index > -1;
  }

  removeStaleSearching(player, identityToken) {
    if (!QueueState.isCompleteIdentity(identityToken)
      || identityToken.username !== player
      || !this.isSearching(player, identityToken)) return false;
    const index = this.searching.indexOf(player);
    if (index > -1) this.searching.splice(index, 1);
    delete this.searchingUserIds[player];
    delete this.searchingIdentities[player];
    return index > -1;
  }

  enqueue(match) {
    this.queue.push(match);
  }

  shiftQueue() {
    return this.queue.shift();
  }

  removeMatchByPlayer(player) {
    const index = this.queue.findIndex(
      (match) => match.player1 === player || match.player2 === player
    );
    if (index === -1) return { match: null, index: -1 };
    const [match] = this.queue.splice(index, 1);
    return { match, index };
  }

  getOwnership(username) {
    const identity = this.ownership[username];
    return identity ? { ...identity } : null;
  }

  getActiveIdentity(username) {
    const identity = this.ownership[username];
    return identity?.status === "active" ? { username, ...identity } : null;
  }

  reserveIdentity(username, userId) {
    if (!username || userId === undefined || userId === null) {
      throw new TypeError("username and userId are required for identity claim");
    }
    const transitions = this.deactivateOtherIdentities(userId, username);
    const current = this.ownership[username];
    if (current && String(current.userId) === String(userId)
      && (current.status === "pending" || current.status === "active")) {
      this.lastIdentityTransitions = QueueState.uniqueIdentities(transitions);
      return { username, ...current, identityEpoch: this.identityEpoch };
    }

    if (current) {
      this.invalidateIdentityReferences(username, current);
      this.addIdentityTombstone(username, current);
      transitions.push({ username, ...current });
    }
    this.identityEpoch += 1;
    const identity = { userId, generation: this.identityEpoch, status: "pending" };
    this.ownership[username] = identity;
    this.lastIdentityTransitions = QueueState.uniqueIdentities(transitions);
    return { username, ...identity, identityEpoch: this.identityEpoch };
  }

  activateIdentity(token) {
    const current = this.ownership[token?.username];
    if (!current || token?.username === undefined || !QueueState.sameIdentity(current, token)) {
      return { ok: false, reason: "identity_token_mismatch" };
    }
    if (this.isBannedIdentity(token)) return { ok: false, reason: "player_banned" };
    if (current.status === "active") return { ok: true, idempotent: true, save: false };
    if (current.status !== "pending" || token.status !== "pending") {
      return { ok: false, reason: "identity_not_pending" };
    }
    current.status = "active";
    return { ok: true, idempotent: false };
  }

  isActiveIdentity(token, username = undefined) {
    const current = this.ownership[token?.username];
    return Boolean(QueueState.isCompleteIdentity(token)
      && (username === undefined || token.username === username)
      && current
      && current.status === "active" && QueueState.sameIdentity(current, token));
  }

  isBannedIdentity(identity) {
    if (identity?.userId === undefined || identity?.userId === null) return false;
    const status = this.bannedUserIds[String(identity.userId)];
    return status === true || status?.banned === true;
  }

  setBannedIdentity(userId, banned, generation = undefined) {
    if (userId === undefined || userId === null) return false;
    const key = String(userId);
    if (banned === true) {
      this.bannedUserIds[key] = { banned: true, generation };
    } else {
      delete this.bannedUserIds[key];
    }
    return true;
  }

  deactivateIdentity(token) {
    const current = this.ownership[token?.username];
    if (!current || token?.username === undefined || !QueueState.sameIdentity(current, token)) return false;
    if (current.status !== "inactive") this.addIdentityTombstone(token.username, current);
    current.status = "inactive";
    return true;
  }

  /**
   * У одного Telegram userId может быть только один current username. Все
   * остальные pending/active записи fencing-ятся в том же CAS, что и reserve.
   */
  deactivateOtherIdentities(userId, exceptUsername) {
    const transitions = [];
    for (const [username, identity] of Object.entries(this.ownership)) {
      if (username === exceptUsername || String(identity.userId) !== String(userId)
        || identity.status === "inactive") continue;
      this.invalidateIdentityReferences(username, identity);
      this.addIdentityTombstone(username, identity);
      identity.status = "inactive";
      transitions.push({ username, ...identity, status: "inactive" });
    }
    return transitions;
  }

  invalidateIdentityReferences(username, identity) {
    const searchIdentity = this.searchingIdentities[username];
    if (searchIdentity && QueueState.sameIdentity(searchIdentity, identity)) {
      this.removeStaleSearching(username, searchIdentity);
    }
  }

  addIdentityTombstone(username, identity) {
    const records = this.identityTombstones[username] || [];
    if (records.some((record) => record.generation === identity.generation)) return;
    records.push({ ...identity, status: "inactive" });
    records.sort((a, b) => a.generation - b.generation);
    this.identityTombstones[username] = records;
  }

  static sameIdentity(left, right) {
    return Boolean(left && right
      && String(left.userId) === String(right.userId)
      && Number(left.generation) === Number(right.generation));
  }

  static sameUser(left, right) {
    return Boolean(left && right
      && left.userId !== undefined && left.userId !== null
      && right.userId !== undefined && right.userId !== null
      && String(left.userId) === String(right.userId));
  }

  static uniqueIdentities(identities) {
    return [...new Map((identities || []).map((identity) => [
      `${identity.username}:${identity.userId}:${identity.generation}`,
      identity,
    ])).values()];
  }
}

export { QueueState };
