const addDefined = (target, key, value) => {
  if (value !== undefined) target[key] = value
}

export const isSyntheticFormerUsername = (username) => /^@__former_/.test(username || '')

export const toPublicMatch = (match) => ({
  player1: match?.player1,
  player2: match?.player2,
  startDate: match?.startDate,
  endDate: match?.endDate,
  status: match?.status,
})

export const toPublicInvite = (invite) => {
  const result = {
    inviteId: invite?.inviteId,
    player: invite?.player,
    opponent: invite?.opponent,
  }
  addDefined(result, 'createdAt', invite?.createdAt)
  addDefined(result, 'expiresAt', invite?.expiresAt)
  return result
}

export const toPublicPlayer = (player) => {
  const result = {
    username: player?.username,
    banned: player?.banned === true,
  }
  for (const field of ['displayName', 'firstName', 'lastName', 'lastSeenAt']) {
    addDefined(result, field, player?.[field])
  }
  return result
}

export const toPublicState = ({
  state,
  paused,
  emergeActive,
  serverTime,
  revision,
  pendingInvites,
}) => {
  const result = {
    queue: (state?.queue || []).map(toPublicMatch),
    searching: [...(state?.searching || [])],
    played: [...(state?.played || [])],
    paused: Boolean(paused),
    emergeActive: Boolean(emergeActive),
    serverTime,
    pendingInvites: (pendingInvites || [])
      .filter((invite) => ![invite?.player, invite?.opponent]
        .some(isSyntheticFormerUsername))
      .map(toPublicInvite),
  }
  // Монотонный счётчик ревизии состояния очереди — в отличие от serverTime
  // (штампуется после чтения состояния, поэтому не гарантирует порядок при
  // параллельных запросах) даёт клиенту надёжный маркер "какой снимок свежее",
  // не зависящий от рассинхронизации часов между процессами.
  addDefined(result, 'revision', revision)
  return result
}
