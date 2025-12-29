import { createNullLogger } from "#infrastructure/logger/Logger.js";

/**
 * Управляет жизненным циклом матчей: планирует старт/финиш,
 * уведомляет участников и актуализирует состояние очереди.
 */
class MatchOrchestrator {
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

  /** Собирает уникальный идентификатор задачи таймера для матча. */
  buildId(prefix, match) {
    return `${prefix}:${match.player1}:${match.player2}:${match.startDate.getTime()}`;
  }

  /** Планирует запуск и завершение указанного матча. */
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

  /** Отменяет таймеры старта и окончания конкретного матча. */
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

  /** Отменяет все запланированные таймеры матчей. */
  cancelAll() {
    this.timer.cancelAll();
    this.logger.warn("Отменены все таймеры матчей");
  }

  /** Обрабатывает завершение матча: сохраняет состояние и запускает следующий матч, если есть. */
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

