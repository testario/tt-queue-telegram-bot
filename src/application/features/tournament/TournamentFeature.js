/**
 * Хранит состояние включения турниров и активных приглашений в рамках процесса бота.
 */
class TournamentFeature {
  /**
   * @param {Object} [deps] Зависимости модуля.
   * @param {(now: Date) => Date} [deps.getInviteExpiration] Время истечения приглашения.
   * @param {(callback: () => void, delayMs: number) => unknown} [deps.schedule] Планировщик очистки.
   * @param {(handle: unknown) => void} [deps.cancel] Отмена планировщика.
   */
  constructor({ getInviteExpiration, schedule, cancel } = {}) {
    this.enabledChats = new Set();
    this.invites = new Map();
    this.nextInviteId = 1;
    this.getInviteExpiration = getInviteExpiration || TournamentFeature.getEndOfDay;
    this.schedule = schedule || ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancel = cancel || ((handle) => clearTimeout(handle));
  }

  /**
   * @param {number|string|null|undefined} chatId Идентификатор чата.
   * @returns {string|null}
   */
  normalizeChatId(chatId) {
    return chatId === null || chatId === undefined ? null : String(chatId);
  }

  /**
   * @param {number|string} chatId Идентификатор чата.
   * @returns {boolean}
   */
  isEnabled(chatId) {
    const key = this.normalizeChatId(chatId);
    return key ? this.enabledChats.has(key) : false;
  }

  /**
   * @param {number|string} chatId Идентификатор чата.
   * @returns {boolean} Был ли режим включен сейчас.
   */
  enable(chatId) {
    const key = this.normalizeChatId(chatId);
    if (!key || this.enabledChats.has(key)) return false;
    this.enabledChats.add(key);
    return true;
  }

  /**
   * @param {number|string} chatId Идентификатор чата.
   * @returns {boolean} Был ли режим выключен сейчас.
   */
  disable(chatId) {
    const key = this.normalizeChatId(chatId);
    if (!key || !this.enabledChats.has(key)) return false;
    this.enabledChats.delete(key);
    this.removeChatInvites(key);
    return true;
  }

  /**
   * @param {number|string} chatId Идентификатор чата.
   * @param {{ player: string, opponent: string }} invite Данные приглашения.
   * @returns {string}
   */
  createInvite(chatId, invite) {
    const key = this.normalizeChatId(chatId);
    const invitationId = `t-${this.nextInviteId}`;
    this.nextInviteId += 1;
    const now = new Date();
    const expiresAt = this.getInviteExpiration(now);
    const delayMs = Math.max(0, expiresAt.getTime() - now.getTime());
    const entry = { ...invite, chatId: key, expiresAt, timer: null };
    this.invites.set(invitationId, entry);
    entry.timer = this.schedule(() => this.removeInvite(invitationId), delayMs);
    return invitationId;
  }

  /**
   * @param {number|string} chatId Идентификатор чата.
   * @param {string} invitationId Идентификатор приглашения.
   * @returns {{ player: string, opponent: string, playerIdentity?: object, opponentIdentity?: object }|null}
   */
  getInvite(chatId, invitationId) {
    const invite = this.invites.get(invitationId);
    const key = this.normalizeChatId(chatId);
    if (!invite || invite.chatId !== key) return null;
    if (invite.expiresAt <= new Date()) {
      this.removeInvite(invitationId);
      return null;
    }
    return {
      player: invite.player,
      opponent: invite.opponent,
      playerIdentity: invite.playerIdentity,
      opponentIdentity: invite.opponentIdentity,
    };
  }

  /**
   * @param {string} invitationId Идентификатор приглашения.
   */
  removeInvite(invitationId) {
    const invite = this.invites.get(invitationId);
    if (!invite) return;
    if (invite.timer) {
      this.cancel(invite.timer);
    }
    this.invites.delete(invitationId);
  }

  /**
   * @param {string} chatId Нормализованный идентификатор чата.
   */
  removeChatInvites(chatId) {
    this.invites.forEach((invite, invitationId) => {
      if (invite.chatId === chatId) {
        this.removeInvite(invitationId);
      }
    });
  }

  /**
   * Возвращает конец календарного дня по местному времени.
   * @param {Date} now Текущее время.
   * @returns {Date}
   */
  static getEndOfDay(now) {
    const endOfDay = new Date(now);
    endOfDay.setHours(24, 0, 0, 0);
    return endOfDay;
  }
}

export { TournamentFeature };
