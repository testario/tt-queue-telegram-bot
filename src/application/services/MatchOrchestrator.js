import { createNullLogger } from "#infrastructure/logger/Logger.js";
import { Match } from "#domain/entities/Match.js";

const MAX_FINISH_ATTEMPTS = 3;
const FINISH_RETRY_DELAY_MS = 1_000;

/**
 * @typedef {import("#application/types.js").Match} Match
 * @typedef {import("#application/types.js").QueueState} QueueState
 * @typedef {import("#application/types.js").Timer} Timer
 * @typedef {import("#application/types.js").Notifier} Notifier
 * @typedef {import("#application/types.js").QueueRepository} QueueRepository
 * @typedef {import("#application/types.js").QueueService} QueueService
 * @typedef {import("#application/types.js").BotMessages} Messages
 * @typedef {import("#application/types.js").Clock} Clock
 * @typedef {import("#application/types.js").Logger} Logger
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
   * @param {() => boolean} [deps.shouldHoldNextMatch]
   */
  constructor({
    chatId,
    timer,
    notifier,
    repository,
    queueService,
    messages,
    clock,
    logger,
    shouldHoldNextMatch,
  }) {
    this.chatId = chatId;
    this.timer = timer;
    this.notifier = notifier;
    this.repository = repository;
    this.queueService = queueService;
    this.messages = messages;
    this.clock = clock;
    this.logger = logger || createNullLogger();
    this.shouldHoldNextMatch = shouldHoldNextMatch || (() => false);
    this.pendingTasks = new Set();
    this.asyncTaskHooks = null;
    this.disposed = false;
    this.disposePromise = null;
  }

  /**
   * Подключает lifecycle callbacks для успешного/неуспешного завершения timer task.
   * @param {{ onSettled?: () => void, onRejected?: (error: Error) => void }|null} hooks
   */
  setAsyncTaskHooks(hooks) {
    this.asyncTaskHooks = hooks;
  }

  /** Выполняет callback таймера, отслеживает его и подавляет unhandled rejection. */
  runTimerTask(task) {
    if (this.disposed) return Promise.resolve();
    const promise = Promise.resolve().then(task);
    this.pendingTasks.add(promise);
    return promise.then(
      this.handleTimerTaskSettled.bind(this, promise),
      this.handleTimerTaskRejected.bind(this, promise)
    );
  }

  handleTimerTaskSettled(promise) {
    this.pendingTasks.delete(promise);
    const hooks = this.asyncTaskHooks;
    if (!hooks || !hooks.onSettled) return;
    try {
      hooks.onSettled();
    } catch (error) {
      this.logger.error("Ошибка callback завершения lifecycle таймера", {
        message: error.message,
      });
    }
  }

  handleTimerTaskRejected(promise, error) {
    this.pendingTasks.delete(promise);
    this.logger.error("Ошибка async-задачи lifecycle таймера", {
      message: error.message,
    });
    const hooks = this.asyncTaskHooks;
    if (!hooks || !hooks.onRejected) return;
    try {
      hooks.onRejected(error);
    } catch (hookError) {
      this.logger.error("Ошибка callback отказа lifecycle таймера", {
        message: hookError.message,
      });
    }
  }

  async drainTimerTasks() {
    while (this.pendingTasks.size > 0) {
      await Promise.allSettled([...this.pendingTasks]);
    }
  }

  async dispose() {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    this.cancelAll();
    this.disposePromise = this.drainTimerTasks().then(() => {
      this.cancelAll();
      this.asyncTaskHooks = null;
    });
    return this.disposePromise;
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
  scheduleLifecycle(match, { scheduleNext = true } = {}) {
    if (this.disposed) return;
    const startId = this.buildId("start", match);
    const now = this.clock.now().getTime();
    const startDelay = Math.max(0, match.startDate.getTime() - now);

    this.logger.info("Запланирован матч", {
      player1: match.player1,
      player2: match.player2,
      startDelayMs: startDelay,
    });
    this.timer.schedule(startId, startDelay, () => {
      if (this.disposed) return;
      this.logger.info("Матч стартовал", {
        player1: match.player1,
        player2: match.player2,
      });
      this.notifier.notify(this.chatId, this.messages.matchStarted(match), {
        type: "match_started",
        match,
      });
      if (this.disposed) return;
      this.scheduleFinish(match, { scheduleNext });
    });
  }

  /**
   * Планирует завершение матча без уведомления о старте.
   * @param {Match} match
   * @returns {void}
   */
  scheduleFinish(match, { scheduleNext = true } = {}) {
    if (this.disposed) return;
    const finishId = this.buildId("finish", match);
    const finishDelay = Math.max(0, match.endDate.getTime() - this.clock.now().getTime());
    this.timer.schedule(finishId, finishDelay, () =>
      this.runTimerTask(() => this.handleMatchFinished(match, { scheduleNext }))
    );
  }

  /**
   * Отменяет таймеры старта и окончания конкретного матча.
   * @param {Match} match
   * @returns {void}
   */
  cancelForMatch(match) {
    const startId = this.buildId("start", match);
    const finishId = this.buildId("finish", match);
    const retryId = this.buildId("finish-retry", match);
    this.timer.cancel(startId);
    this.timer.cancel(finishId);
    this.timer.cancel(retryId);
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
   * Проверяет, что callback всё ещё относится к точной текущей playing-head.
   * @param {Match} match
   * @param {QueueState} state
   * @returns {boolean}
   */
  isExpectedPlayingHead(match, state) {
    const current = Array.isArray(state.queue) ? state.queue[0] : null;
    return Boolean(
      match.status === Match.statuses.playing &&
        current &&
        current.status === Match.statuses.playing &&
        current.player1 === match.player1 &&
        current.player2 === match.player2 &&
        current.startDate.getTime() === match.startDate.getTime() &&
        current.endDate.getTime() === match.endDate.getTime()
    );
  }

  /**
   * Повторно проверяет head перед отложенным запуском завершения.
   * Задержка нужна, чтобы не создать tight loop при постоянно конфликтующем CAS.
   * @param {Match} match
   * @param {boolean} scheduleNext
   * @returns {Promise<void>}
   */
  async scheduleFinishReconciliation(match, scheduleNext) {
    if (this.disposed) return;
    const versioned = await this.repository.getVersioned();
    if (this.disposed) return;
    if (!this.isExpectedPlayingHead(match, versioned.state)) {
      this.logger.warn("Отложенное завершение отменено: head больше не актуальна", {
        player1: match.player1,
        player2: match.player2,
      });
      return;
    }

    const retryId = this.buildId("finish-retry", match);
    this.timer.schedule(retryId, FINISH_RETRY_DELAY_MS, () =>
      this.runTimerTask(() => this.handleMatchFinished(match, { scheduleNext }))
    );
    this.logger.warn("Завершение матча отложено после конфликтов CAS", {
      player1: match.player1,
      player2: match.player2,
      delayMs: FINISH_RETRY_DELAY_MS,
    });
  }

  /**
   * Обрабатывает завершение матча: сохраняет состояние и запускает следующий матч, если есть.
   * @param {Match} match
   * @param {{ scheduleNext?: boolean }} [options]
   * @returns {Promise<void>}
   */
  async handleMatchFinished(match, { scheduleNext = true } = {}) {
    if (this.disposed) return;
    this.logger.info("Матч завершен", {
      player1: match.player1,
      player2: match.player2,
    });
    for (let attempt = 1; attempt <= MAX_FINISH_ATTEMPTS; attempt += 1) {
      if (this.disposed) return;
      const versioned = await this.repository.getVersioned();
      if (this.disposed) return;
      const { state } = versioned;
      if (!this.isExpectedPlayingHead(match, state)) {
        this.logger.warn("Пропущено завершение устаревшего матча", {
          player1: match.player1,
          player2: match.player2,
        });
        return;
      }

      const { state: nextState, nextMatch, heldNextMatch } = this.queueService.finishCurrent(
        state,
        this.clock.now()
      );
      const holdNext = Boolean(nextMatch && this.shouldHoldNextMatch());
      if (holdNext && nextMatch) {
        nextMatch.status = Match.statuses.waiting;
      }

      const saved = await this.repository.saveIfRevision(versioned.revision, nextState);
      if (this.disposed) return;
      if (!saved) {
        this.logger.warn("Конфликт версии при завершении матча, повтор операции", {
          player1: match.player1,
          player2: match.player2,
          attempt,
          maxAttempts: MAX_FINISH_ATTEMPTS,
        });
        continue;
      }

      if (heldNextMatch) {
        this.logger.info("Следующий матч удержан durable pause-флагом", {
          player1: heldNextMatch.player1,
          player2: heldNextMatch.player2,
        });
        this.notifier.notify(this.chatId, this.messages.matchFinished(match));
        return;
      }

      if (nextMatch) {
        if (holdNext) {
          this.logger.info("Очередь на паузе: следующий матч удержан", {
            player1: nextMatch.player1,
            player2: nextMatch.player2,
          });
          this.notifier.notify(this.chatId, this.messages.matchFinished(match));
          return;
        }
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
        if (scheduleNext) this.scheduleLifecycle(nextMatch);
        return;
      }
      this.notifier.notify(this.chatId, this.messages.matchFinished(match));
      return;
    }
    this.logger.warn("Завершение матча отменено после исчерпания попыток CAS", {
      player1: match.player1,
      player2: match.player2,
      maxAttempts: MAX_FINISH_ATTEMPTS,
    });
    await this.scheduleFinishReconciliation(match, scheduleNext);
  }
}

export { MatchOrchestrator };
