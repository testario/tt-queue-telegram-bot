/**
 * Системные часы, предоставляющие текущее время.
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

