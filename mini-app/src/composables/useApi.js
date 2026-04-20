import { useTelegram } from './useTelegram.js'

export function useApi() {
  const { initData } = useTelegram()

  const request = async (method, path, body = undefined) => {
    const headers = {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': initData,
    }
    const res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'unknown' }))
      throw new Error(error.error || `HTTP ${res.status}`)
    }

    return res.json()
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    del: (path, body) => request('DELETE', path, body),
  }
}
