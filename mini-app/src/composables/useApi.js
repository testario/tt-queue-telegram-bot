import { useTelegram } from './useTelegram.js'
import { reactive, readonly } from 'vue'

const banState = reactive({ isBanned: false })

export function useBanStatus() {
  return readonly(banState)
}

export const markPlayerBanned = () => {
  banState.isBanned = true
}

const registrationState = reactive({ verified: false })

export function useRegistrationStatus() {
  return readonly(registrationState)
}

export const markPlayerVerified = () => {
  registrationState.verified = true
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
