const tg = window.Telegram?.WebApp

export function useTelegram() {
  const user = tg?.initDataUnsafe?.user ?? null
  const initData = tg?.initData ?? ''
  const username = user?.username ?? null
  const player = username ? `@${username}` : null

  const ready = () => tg?.ready()
  const close = () => tg?.close()
  const expand = () => tg?.expand()

  return { user, initData, username, player, ready, close, expand }
}
