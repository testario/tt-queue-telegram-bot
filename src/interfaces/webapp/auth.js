import { createHmac } from 'crypto'

// Telegram обновляет initData при каждом открытии мини-аппа, поэтому разумное
// окно не мешает обычному использованию — но без него валидный initData,
// однажды утёкший (например, через access-логи прокси при передаче query-
// строкой в SSE, см. GET /api/events), остаётся рабочим бессрочно.
const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60

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

  // params.get возвращает null при отсутствующем ключе, а Number(null) — это
  // 0, а не NaN: без явной проверки на пустую строку "нет auth_date" тихо
  // превращается в "auth_date=0" и отдаётся клиенту как stale_init_data
  // вместо настоящей причины.
  const authDateRaw = params.get('auth_date')
  if (!authDateRaw || !Number.isFinite(Number(authDateRaw))) {
    return { ok: false, reason: 'missing_auth_date' }
  }
  const authDate = Number(authDateRaw)
  if (Date.now() / 1000 - authDate > MAX_INIT_DATA_AGE_SECONDS) {
    return { ok: false, reason: 'stale_init_data' }
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