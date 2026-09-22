// Кулдаун по умолчанию для антиспам-кнопок (поиск, приглашение) — общий,
// чтобы не заводить одну и ту же константу в каждом месте использования.
const DEFAULT_COOLDOWN_MS = 2000

/**
 * Гарантирует, что fn() "висит" не меньше ms — сам запрос может ответить за
 * доли секунды, а кнопка должна оставаться в состоянии загрузки заметное
 * время, чтобы повторный тап не улетел вторым запросом того же действия.
 * @param {() => Promise<any>} fn - асинхронное действие, которое нужно выполнить.
 * @param {number} [ms=DEFAULT_COOLDOWN_MS] - минимальная длительность в миллисекундах.
 * @returns {Promise<any>} результат fn() (успех или ошибка — после добора времени).
 */
export const withMinDuration = async (fn, ms = DEFAULT_COOLDOWN_MS) => {
  const startedAt = Date.now()
  try {
    return await fn()
  } finally {
    const remaining = ms - (Date.now() - startedAt)
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))
  }
}
