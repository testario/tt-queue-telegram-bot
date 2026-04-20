// Форматирует Date в HH:MM
export const formatTime = (date) =>
  date instanceof Date
    ? date.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
    : '—'

// Форматирует оставшееся время в MM:SS
export const formatCountdown = (ms) => {
  if (ms <= 0) return '00:00'
  const totalSec = Math.floor(ms / 1000)
  const min = Math.floor(totalSec / 60).toString().padStart(2, '0')
  const sec = (totalSec % 60).toString().padStart(2, '0')
  return `${min}:${sec}`
}
