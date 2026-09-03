export function useTelegram() {
  const tg = window.Telegram?.WebApp
  const user = tg?.initDataUnsafe?.user ?? null
  const initData = tg?.initData ?? ''
  const username = user?.username ?? null
  const player = username ? `@${username}` : null

  const ready = () => window.Telegram?.WebApp?.ready()
  const close = () => window.Telegram?.WebApp?.close()
  const expand = () => window.Telegram?.WebApp?.expand()

  return { user, initData, username, player, ready, close, expand }
}
