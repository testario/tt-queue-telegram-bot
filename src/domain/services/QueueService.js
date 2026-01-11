import { Match } from "../entities/Match.js";
import { QueueState } from "../entities/QueueState.js";

/**
 * Сервис управления очередью матчей и расписанием.
 */
class QueueService {
  /**
   * @param {Object} params Конфигурация сервиса.
   * @param {number} params.readyMs Время на подготовку перед матчем, мс.
   * @param {number} params.gameMs Длительность матча, мс.
   * @param {Object} [params.workSchedule] Настройки рабочего дня.
   */
  constructor({ readyMs, gameMs, workSchedule }) {
    this.readyMs = readyMs;
    this.gameMs = gameMs;
    this.workSchedule =
      workSchedule ||
      {
        workStart: { hour: 10, minute: 0 },
        lunchStart: { hour: 14, minute: 0 },
        lunchDurationMinutes: 60,
        workEnd: { hour: 19, minute: 0 },
      };
  }

  /**
   * Создает исходное состояние очереди.
   * @returns {QueueState}
   */
  createInitialState() {
    return QueueState.createEmpty();
  }

  /**
   * Регистрирует игрока в поиске.
   * @param {QueueState} state Текущее состояние.
   * @param {string} player Игрок.
   * @param {Date} [now] Текущее время.
   * @returns {{state: QueueState, status: "added"|"already_searching"|"in_queue"|"played"|"unknown"}}
   */
  registerSearch(state, player, now = new Date()) {
    const { state: normalizedState } = this.normalizeState(state, now);
    const nextState = normalizedState.clone();
    if (!nextState.hasPlayer(player)) {
      nextState.addSearching(player);
      return { state: nextState, status: "added" };
    }
    if (nextState.isSearching(player)) {
      return { state: nextState, status: "already_searching" };
    }
    if (nextState.isQueued(player)) {
      return { state: nextState, status: "in_queue" };
    }
    if (nextState.isPlayed(player)) {
      return { state: nextState, status: "played" };
    }
    return { state: nextState, status: "unknown" };
  }

  /**
   * Отменяет поиск игрока.
   * @param {QueueState} state Текущее состояние.
   * @param {string} player Игрок.
   * @param {Date} [now] Текущее время.
   * @returns {{state: QueueState, status: "removed"|"not_found"}}
   */
  cancelSearch(state, player, now = new Date()) {
    const { state: normalizedState } = this.normalizeState(state, now);
    const nextState = normalizedState.clone();
    if (nextState.isSearching(player)) {
      nextState.removeSearching(player);
      return { state: nextState, status: "removed" };
    }
    return { state: nextState, status: "not_found" };
  }

  /**
   * Планирует матч и добавляет его в очередь.
   * @param {QueueState} state Текущее состояние.
   * @param {string} player1 Первый игрок (должен быть в поиске).
   * @param {string} player2 Второй игрок.
   * @param {Date} now Текущее время.
   * @returns {{ok: false, reason: string, state: QueueState}|{ok: true, state: QueueState, match: import("../entities/Match.js").Match}}
   */
  scheduleMatch(state, player1, player2, now) {
    if (player1 === player2) {
      return { ok: false, reason: "same_player", state };
    }
    const { state: normalizedState } = this.normalizeState(state, now);
    const nextState = normalizedState.clone();
    if (nextState.isPlayed(player1) || nextState.isPlayed(player2)) {
      return { ok: false, reason: "already_played", state: nextState };
    }
    if (nextState.isQueued(player1) || nextState.isQueued(player2)) {
      return { ok: false, reason: "already_in_queue", state: nextState };
    }
    if (!nextState.isSearching(player1)) {
      return { ok: false, reason: "player1_not_searching", state: nextState };
    }

    nextState.removeSearching(player1);

    const lastMatch = nextState.queue[nextState.queue.length - 1];
    const baseStart = lastMatch ? lastMatch.endDate : now;
    const startDate = new Date(baseStart.getTime() + this.readyMs);
    const endDate = new Date(startDate.getTime() + this.gameMs);
    const status =
      nextState.queue.length === 0
        ? Match.statuses.playing
        : Match.statuses.waiting;

    const match = Match.create({
      player1,
      player2,
      startDate,
      endDate,
      status,
    });

    nextState.enqueue(match);

    return { ok: true, state: nextState, match };
  }

  /**
   * Завершает текущий матч и продвигает очередь.
   * @param {QueueState} state Текущее состояние.
   * @param {Date} now Текущее время.
   * @returns {{state: QueueState, endedMatch: import("../entities/Match.js").Match|undefined, nextMatch: import("../entities/Match.js").Match|null}}
   */
  finishCurrent(state, now) {
    const { state: normalizedState, isLunchTime, isAfterWork } =
      this.normalizeState(state, now);
    const nextState = normalizedState.clone();
    const endedMatch = nextState.shiftQueue();
    let nextMatch = null;

    if (endedMatch && !isLunchTime && !isAfterWork) {
      nextState.played.push(endedMatch.player1, endedMatch.player2);
    }

    if (nextState.queue.length > 0) {
      const current = nextState.queue[0];
      current.status = Match.statuses.playing;
      current.startDate = new Date(now.getTime() + this.readyMs);
      current.endDate = new Date(current.startDate.getTime() + this.gameMs);
      nextMatch = current;
      this.recalculateWaiting(nextState);
    }

    return { state: nextState, endedMatch, nextMatch };
  }

  /**
   * Отменяет матч по участнику.
   * @param {QueueState} state Текущее состояние.
   * @param {string} player Игрок для отмены.
   * @param {Date} now Текущее время.
   * @returns {Object} Результат отмены с новым состоянием.
   */
  cancelMatch(state, player, now) {
    const { state: normalizedState } = this.normalizeState(state, now);
    const nextState = normalizedState.clone();
    const { match, index } = nextState.removeMatchByPlayer(player);

    if (!match) {
      return { state: nextState, status: "not_found" };
    }

    if (index === 0) {
      const currentTime = now.getTime();
      // Оставшееся время для пользователей: считаем до конца матча, включая подготовку, если отмена пришла раньше старта.
      const remains = Math.max(0, match.endDate.getTime() - currentTime);

      let nextMatch = null;
      if (nextState.queue.length > 0) {
        const current = nextState.queue[0];
        current.status = Match.statuses.playing;
        current.startDate = new Date(currentTime + this.readyMs);
        current.endDate = new Date(current.startDate.getTime() + this.gameMs);
        nextMatch = current;
        this.recalculateWaiting(nextState);
      }

      return {
        state: nextState,
        status: "removed_current",
        removedMatch: match,
        nextMatch,
        remains,
      };
    }

    this.recalculateWaiting(nextState);
    return {
      state: nextState,
      status: "removed_waiting",
      removedMatch: match,
    };
  }

  /**
   * Пересчитывает времена ожидания для очереди.
   * @param {QueueState} state Состояние с очередью.
   */
  recalculateWaiting(state) {
    if (state.queue.length === 0) return;

    let previous = state.queue[0];
    for (let i = 1; i < state.queue.length; i++) {
      const match = state.queue[i];
      match.status = Match.statuses.waiting;
      match.startDate = new Date(previous.endDate.getTime() + this.readyMs);
      match.endDate = new Date(match.startDate.getTime() + this.gameMs);
      previous = match;
    }
  }

  /**
   * Нормализует состояние с учетом расписания дня.
   * @param {QueueState} state Текущее состояние.
   * @param {Date} now Текущее время.
   * @returns {{state: QueueState, isLunchTime: boolean, isAfterWork: boolean}}
   */
  normalizeState(state, now) {
    const nextState = state.clone();
    const {
      workStartTime,
      lunchStart,
      lunchEnd,
      workEnd,
      lunchStartTime,
      workEndTime,
    } = this.resolveSchedule(now);

    if (!nextState.lastPlayedResetAt) {
      nextState.lastPlayedResetAt = new Date(now);
    }

    const lastResetTime = nextState.lastPlayedResetAt.getTime();

    const currentTime = now.getTime();
    const shouldResetAtDayStart =
      currentTime >= workStartTime && lastResetTime < workStartTime;
    const shouldResetAtLunch =
      currentTime >= lunchStartTime && lastResetTime < lunchStartTime;
    const shouldResetAtWorkEnd =
      currentTime >= workEndTime && lastResetTime < workEndTime;

    if (shouldResetAtDayStart || shouldResetAtLunch || shouldResetAtWorkEnd) {
      nextState.played = [];
      nextState.lastPlayedResetAt = new Date(now);
    }

    const isLunchTime = now >= lunchStart && now < lunchEnd;
    const isAfterWork = now >= workEnd;

    return { state: nextState, isLunchTime, isAfterWork };
  }

  /**
   * Формирует временные метки для текущего дня по расписанию.
   * @param {Date} now Текущее время.
   * @returns {{workStartTime: number, lunchStart: Date, lunchEnd: Date, workEnd: Date, lunchStartTime: number, workEndTime: number}}
   */
  resolveSchedule(now) {
    const lunchStart = this.toTodayTime(now, this.workSchedule.lunchStart);
    const lunchEnd = new Date(
      lunchStart.getTime() + this.workSchedule.lunchDurationMinutes * 60 * 1000
    );
    const workStart = this.toTodayTime(now, this.workSchedule.workStart);
    const workEnd = this.toTodayTime(now, this.workSchedule.workEnd);

    return {
      workStartTime: workStart.getTime(),
      lunchStart,
      lunchEnd,
      workEnd,
      lunchStartTime: lunchStart.getTime(),
      workEndTime: workEnd.getTime(),
    };
  }

  /**
   * Приводит произвольное время к дате сегодняшнего дня.
   * @param {Date} base Базовая дата.
   * @param {{hour: number, minute?: number}} param1 Часы и минуты.
   * @returns {Date}
   */
  toTodayTime(base, { hour, minute = 0 }) {
    const date = new Date(base);
    date.setHours(hour, minute, 0, 0);
    return date;
  }
}

export { QueueService };

