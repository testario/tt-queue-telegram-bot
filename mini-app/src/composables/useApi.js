import { useTelegram } from './useTelegram.js'
import { reactive, readonly } from 'vue'

const banState = reactive({ isBanned: false })

export function useBanStatus() {
  return readonly(banState)
}

export const markPlayerBanned = () => {
  banState.isBanned = true
}

// null — статус ещё не известен (запрос к /api/players в полёте): пока он
// null, App.vue не должен рендерить ни LoginScreen, ни обычный интерфейс —
// иначе на любом заходе мелькает логин-экран, даже когда игрок давно
// подтверждён, просто ответ ещё не пришёл. true/false — статус подтверждён
// ответом сервера.
const registrationState = reactive({ verified: null })

export function useRegistrationStatus() {
  return readonly(registrationState)
}

export const markPlayerVerified = () => {
  registrationState.verified = true
}

// Серверно verified монотонен — ни один REST-ответ и ни один SSE-пуш не
// переводит уже подтверждённого игрока обратно в false (единственный способ
// потерять подтверждение — смена владельца username, а это уже другой
// человек и другая сессия, см. router.js). Поэтому здесь тоже нельзя опускать
// true → false: иначе устаревший снимок GET /api/players, пришедший ПОСЛЕ
// SSE-пуша player_verified, или сетевой сбой при загрузке списка игроков
// откатывают уже подтверждённого игрока обратно на логин-экран.
export const markPlayerUnverified = () => {
  if (registrationState.verified === null) registrationState.verified = false
}

export function useApi() {
  const { initData } = useTelegram()

  const request = async (method, path, body = undefined) => {
    const headers = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (initData) headers['X-Telegram-Init-Data'] = initData
    const res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'unknown' }))
      if (error.error === 'player_banned') markPlayerBanned()
      throw new Error(error.error || `HTTP ${res.status}`)
    }

    return res.json()
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    patch: (path, body) => request('PATCH', path, body),
    del: (path, body) => request('DELETE', path, body),
  }
}
