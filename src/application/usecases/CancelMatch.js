import { createNullLogger } from "#infrastructure/logger/Logger.js";

class CancelMatch {
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

  async execute(player) {
    this.logger.info("Отмена матча запрошена", { player });
    const state = await this.repository.get();
    const now = this.clock.now();
    const result = this.queueService.cancelMatch(state, player, now);
    await this.repository.save(result.state);

    if (result.status === "not_found") {
      this.logger.warn("Матч для отмены не найден", { player });
      return { ok: false, reason: "not_found" };
    }

    if (result.removedMatch) {
      this.logger.info("Матч отменен", {
        player,
        player1: result.removedMatch.player1,
        player2: result.removedMatch.player2,
        status: result.status,
      });
      this.orchestrator.cancelForMatch(result.removedMatch);
    }

    if (result.status === "removed_current") {
      this.notifier.notify(this.chatId, this.messages.cancelCurrent(player));
      if (result.nextMatch) {
        this.logger.info("Продвигаем следующий матч после отмены текущего", {
          player1: result.nextMatch.player1,
          player2: result.nextMatch.player2,
        });
        this.notifier.notify(this.chatId, this.messages.nextPair(result.nextMatch));
        this.orchestrator.scheduleLifecycle(result.nextMatch);
      }
      return { ok: true, status: result.status };
    }

    this.notifier.notify(this.chatId, this.messages.cancelWaiting(player));
    return { ok: true, status: result.status };
  }
}

export { CancelMatch };

