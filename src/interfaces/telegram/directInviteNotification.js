/**
 * Отправляет прямое приглашение получателю в личные сообщения.
 * Если Telegram не позволяет доставить сообщение, сохраняется групповое
 * уведомление с той же клавиатурой.
 *
 * @returns {Promise<{ sentDirect: boolean }>}
 */
export const sendDirectInviteNotification = async ({
  bot,
  invite,
  text,
  replyMarkup,
  directReplyMarkup = replyMarkup,
  fallbackChatId,
  log,
  fallbackOptions = {},
}) => {
  let recipient
  try {
    recipient = invite.opponentIdentity?.userId != null
      ? { userId: invite.opponentIdentity.userId }
      : null
  } catch {
    log?.warn('Не удалось найти Telegram userId получателя прямого приглашения', {
      recipient: invite.opponent,
      reason: 'player_lookup_failed',
    })
  }

  const options = { reply_markup: directReplyMarkup }
  if (recipient?.userId !== undefined && recipient?.userId !== null) {
    try {
      await bot.sendMessage(recipient.userId, text, options)
      return { sentDirect: true }
    } catch {
      log?.warn('Не удалось отправить прямое приглашение в личные сообщения', {
        recipient: invite.opponent,
        reason: 'direct_message_unavailable',
      })
    }
  } else {
    log?.warn('У получателя прямого приглашения отсутствует Telegram userId', {
      recipient: invite.opponent,
      reason: 'user_id_missing',
    })
  }

  await bot.sendMessage(fallbackChatId, text, { ...fallbackOptions, reply_markup: replyMarkup })
  return { sentDirect: false }
}
