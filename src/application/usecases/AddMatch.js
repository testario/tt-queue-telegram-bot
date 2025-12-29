import { Match } from "#domain";
import { createNullLogger } from "#infrastructure/logger/Logger.js";

/** Юзкейс создания матча и постановки его в очередь либо немедленного старта. */
class AddMatch {
  constructor({
    chatId,
    repository,
    queueService,
    orchestrator,
    notifier,
    messages,
    clock,
    logger,
  }) {
    this.chatId = chatId;
    this.repository = repository;
    this.queueService = queueService;
    this.orchestrator = orchestrator;
    this.notifier = notifier;
    this.messages = messages;
    this.clock = clock;
    this.logger = logger || createNullLogger();
  }

  /** Добавляет матч между двумя игроками, уведомляет чат и при необходимости планирует таймеры. */
  async execute(player1, player2) {
    this.logger.info("Попытка создать матч", { player1, player2 });
    const state = await this.repository.get();
    const now = this.clock.now();
    const result = this.queueService.scheduleMatch(state, player1, player2, now);

    if (!result.ok) {
      this.logger.warn("Матч не создан", { player1, player2, reason: result.reason });
      return {
        ok: false,
        reason: result.reason,
        text: this.failureMessage(result.reason),
      };
    }

    await this.repository.save(result.state);

    const { match } = result;
    this.logger.info("Матч создан", {
      player1: match.player1,
      player2: match.player2,
      startDate: match.startDate.toISOString(),
      endDate: match.endDate.toISOString(),
      status: match.status,
    });
    const creationText = this.messages.matchCreated(match);
    this.notifier.notify(this.chatId, creationText);

    if (match.status === Match.statuses.playing) {
      this.logger.debug("Матч стартует сразу, планируем жизненный цикл", {
        player1: match.player1,
        player2: match.player2,
      });
      this.orchestrator.scheduleLifecycle(match);
    }

    return { ok: true, match, text: creationText };
  }

  /** Возвращает текст ошибки для причины неудачного создания матча. */
  failureMessage(reason) {
    switch (reason) {
      case "already_in_queue":
        return this.messages.matchAlreadyInQueue();
      case "already_played":
        return this.messages.matchAlreadyPlayed();
      case "player1_not_searching":
        return this.messages.matchPlayerNotSearching();
      case "same_player":
        return this.messages.matchSamePlayer();
      default:
        return this.messages.matchAlreadyInQueue();
    }
  }
}

export { AddMatch };

