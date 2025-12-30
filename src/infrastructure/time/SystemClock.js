/**
 * Системные часы, предоставляющие текущее время.
 */
/**
 * @implements {import("#application/types.js").Clock}
 */
class SystemClock {
  /**
   * Возвращает текущую дату/время.
   * @returns {Date}
   */
  now() {
    return new Date();
  }
}

export { SystemClock };

