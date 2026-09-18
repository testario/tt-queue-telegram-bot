const MAX_CALLBACK_DATA_BYTES = 64

/**
 * Клавиатура для заявки на поиск соперника.
 * @param {string} player
 * @param {{ inline: { playWith: string, cancelOwn: string } }} ui
 * @returns {{ inline_keyboard: Array }}
 */
export const buildSearchInlineKeyboard = (player, ui) => ({
  inline_keyboard: [
    [
      { text: ui.inline.playWith, callback_data: 'i_want_to_play_with_:' + player },
      { text: ui.inline.cancelOwn, callback_data: 'i_want_to_cancel:' + player },
    ],
  ],
})

/**
 * Клавиатура для отмены матча участниками.
 * @param {{ player1: string, player2: string }|null|undefined} match
 * @param {{ inline: { confirmNoTime: string } }} ui
 * @param {object|null} [log]
 * @returns {{ inline_keyboard: Array }|undefined}
 */
export const buildMatchCancelKeyboard = (match, ui, log = null) => {
  if (!match) return undefined

  const callbackData = `i_want_to_out:${match.player1},${match.player2}`
  const payloadBytes = Buffer.byteLength(callbackData, 'utf8')
  if (payloadBytes > MAX_CALLBACK_DATA_BYTES) {
    if (log) {
      log.warn('Пропускаем клавиатуру отмены: callback_data слишком длинная', {
        player1: match.player1,
        player2: match.player2,
        payloadBytes,
      })
    }
    return undefined
  }

  return {
    inline_keyboard: [[{ text: ui.inline.confirmNoTime, callback_data: callbackData }]],
  }
}

export const buildDirectInviteRecipientKeyboard = (invite, ui) => {
  if (!invite?.inviteId) return undefined

  return {
    inline_keyboard: [
      [
        { text: ui.inline.directAccept, callback_data: `direct_accept:${invite.inviteId}` },
        { text: ui.inline.directDecline, callback_data: `direct_decline:${invite.inviteId}` },
      ],
    ],
  }
}

export const buildDirectInviteInitiatorKeyboard = (invite, ui) => {
  if (!invite?.inviteId) return undefined

  return {
    inline_keyboard: [
      [
        { text: ui.inline.directCancel, callback_data: `direct_cancel:${invite.inviteId}` },
      ],
    ],
  }
}

/**
 * Клавиатура для fallback-уведомления в общем чате.
 * @param {{ inviteId: string }} invite
 * @param {{ inline: { directAccept: string, directDecline: string, directCancel: string } }} ui
 * @returns {{ inline_keyboard: Array }}
 */
export const buildDirectInviteKeyboard = (invite, ui) => {
  const recipientKeyboard = buildDirectInviteRecipientKeyboard(invite, ui)
  const initiatorKeyboard = buildDirectInviteInitiatorKeyboard(invite, ui)
  if (!recipientKeyboard || !initiatorKeyboard) return undefined

  return {
    inline_keyboard: [
      ...recipientKeyboard.inline_keyboard,
      ...initiatorKeyboard.inline_keyboard,
    ],
  }
}
