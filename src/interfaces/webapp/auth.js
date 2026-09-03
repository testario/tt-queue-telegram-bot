import { createHmac } from 'crypto'

/**
 * Верифицирует Telegram initData через HMAC-SHA256.
 *
 * Алгоритм по документации Telegram:
 * 1. Разбить строку на пары key=value, отсортировать по ключу
 * 2. Исключить пару hash=...
 * 3. Сформировать data_check_string: key=value\nkey=value\n...
 * 4. secret_key = HMAC-SHA256(bot_token, "WebAppData")
 * 5. Сравнить HMAC-SHA256(data_check_string, secret_key) с hash из initData
 *
 * @param {string|undefined} initData
 * @param {string} botToken
 * @returns {{ ok: true, user: object } | { ok: false, reason: string }}
 */
export const verifyInitData = (initData, botToken) => {
  if (!initData) {
    return { ok: false, reason: 'missing_init_data' }
  }

  let params
  try {
    params = new URLSearchParams(initData)
  } catch {
    return { ok: false, reason: 'invalid_init_data_format' }
  }

  const hash = params.get('hash')
  if (!hash) {
    return { ok: false, reason: 'missing_hash' }
  }

  // Строим data_check_string: все пары кроме hash, отсортированные по ключу
  const entries = []
  params.forEach((value, key) => {
    if (key !== 'hash') {
      entries.push(`${key}=${value}`)
    }
  })
  entries.sort()
  const dataCheckString = entries.join('\n')

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const expectedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

  if (expectedHash !== hash) {
    return { ok: false, reason: 'invalid_hash' }
  }

  const userRaw = params.get('user')
  if (!userRaw) {
    return { ok: false, reason: 'missing_user' }
  }

  let user
  try {
    user = JSON.parse(userRaw)
  } catch {
    return { ok: false, reason: 'invalid_user_json' }
  }

  return {
    ok: true,
    user: {
      id: user.id,
      username: user.username ?? null,
      firstName: user.first_name ?? '',
      lastName: user.last_name ?? '',
    },
  }
}