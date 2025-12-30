import { createNullLogger } from "#infrastructure/logger/Logger.js";

/**
 * @typedef {import("#domain/entities/Match.js").Match} Match
 * @typedef {import("#domain/entities/QueueState.js").QueueState} QueueState
 * @typedef {{ schedule: (id: string, delay: number, callback: () => void) => void, cancel: (id: string) => void, cancelAll: () => void }} Timer
 * @typedef {{ notify: (chatId: string, text: string) => void }} Notifier
 * @typedef {{ get: () => Promise<QueueState>, save: (state: QueueState) => Promise<void> }} QueueRepository
 * @typedef {{ finishCurrent: (state: QueueState, now: Date) => { state: QueueState, nextMatch: Match | null } }} QueueService
 * @typedef {{ matchStarted: (match: Match) => string, matchFinishedWithNext: (payload: { finished: Match, next: Match }) => string, matchFinished: (match: Match) => string }} Messages
 * @typedef {{ now: () => Date }} Clock
 * @typedef {{ info: Function, warn: Function, debug: Function }} Logger
 */

/**
 * Управляет жизненным циклом матчей: планирует старт/финиш,
 * уведомляет участников и актуализирует состояние очереди.
 */
class MatchOrchestrator {
  /**
   * @param {Object} deps
   * @param {string} deps.chatId
   * @param {Timer} deps.timer
   * @param {Notifier} deps.notifier
   * @param {QueueRepository} deps.repository
   * @param {QueueService} deps.queueService
   * @param {Messages} deps.messages
   * @param {Clock} deps.clock
   * @param {Logger} [deps.logger]
   */
  constructor({ chatId, timer, notifier, repository, queueService, messages, clock, logger }) {
    this.chatId = chatId;
    this.timer = timer;
    this.notifier = notifier;
    this.repository = repository;
    this.queueService = queueService;
    this.messages = messages;
    this.clock = clock;
    this.logger = logger || createNullLogger();
  }

  /**
   * Собирает уникальный идентификатор задачи таймера для матча.
   * @param {string} prefix
   * @param {Match} match
   * @returns {string}
   */
  buildId(prefix, match) {
    return `${prefix}:${match.player1}:${match.player2}:${match.startDate.getTime()}`;
  }

  /**
   * Планирует запуск и завершение указанного матча.
   * @param {Match} match
   * @returns {void}
   */
  scheduleLifecycle(match) {
    const startId = this.buildId("start", match);
    const finishId = this.buildId("finish", match);
    const now = this.clock.now().getTime();
    const startDelay = Math.max(0, match.startDate.getTime() - now);

    this.logger.info("Запланирован матч", {
      player1: match.player1,
      player2: match.player2,
      startDelayMs: startDelay,
    });
    this.timer.schedule(startId, startDelay, () => {
      this.logger.info("Матч стартовал", {
        player1: match.player1,
        player2: match.player2,
      });
      this.notifier.notify(this.chatId, this.messages.matchStarted(match));
      const finishDelay = Math.max(0, match.endDate.getTime() - this.clock.now().getTime());
      this.timer.schedule(finishId, finishDelay, () =>
        this.handleMatchFinished(match)
      );
    });
  }

  /**
   * Отменяет таймеры старта и окончания конкретного матча.
   * @param {Match} match
   * @returns {void}
   */
  cancelForMatch(match) {
    const startId = this.buildId("start", match);
    const finishId = this.buildId("finish", match);
    this.timer.cancel(startId);
    this.timer.cancel(finishId);
    this.logger.info("Отменено расписание матча", {
      player1: match.player1,
      player2: match.player2,
    });
  }

  /**
   * Отменяет все запланированные таймеры матчей.
   * @returns {void}
   */
  cancelAll() {
    this.timer.cancelAll();
    this.logger.warn("Отменены все таймеры матчей");
  }

  /**
   * Обрабатывает завершение матча: сохраняет состояние и запускает следующий матч, если есть.
   * @param {Match} match
   * @returns {Promise<void>}
   */
  async handleMatchFinished(match) {
    this.logger.info("Матч завершен", {
      player1: match.player1,
      player2: match.player2,
    });
    const state = await this.repository.get();
    const { state: nextState, nextMatch } = this.queueService.finishCurrent(
      state,
      this.clock.now()
    );
    await this.repository.save(nextState);
    if (nextMatch) {
      this.logger.info("Переход к следующей паре", {
        player1: nextMatch.player1,
        player2: nextMatch.player2,
      });
      this.notifier.notify(
        this.chatId,
        this.messages.matchFinishedWithNext({
          finished: match,
          next: nextMatch,
        })
      );
      this.scheduleLifecycle(nextMatch);
      return;
    }
    this.notifier.notify(this.chatId, this.messages.matchFinished(match));
  }
}

export { MatchOrchestrator };

