/**
 * Базовая ошибка домена.
 */
class DomainError extends Error {
  /**
   * @param {string} message Текстовое описание ошибки.
   * @param {string} code Машинно-читабельный код ошибки.
   */
  constructor(message, code) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export { DomainError };

