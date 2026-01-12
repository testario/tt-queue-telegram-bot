import { createNullLogger } from "#infrastructure/logger/Logger.js";

/**
 * @typedef {import("#application/types.js").BotMessages} Messages
 * @typedef {import("#application/types.js").Logger} Logger
 * @typedef {import("#application/types.js").QueueRepository} QueueRepository
 * @typedef {import("#application/types.js").QueueService} QueueService
 * @typedef {import("#application/types.js").Clock} Clock
 */

/**
 * Юзкейс прямого создания матча по указанному нику оппонента.
 * Выполняет регистрацию поиска инициатора и возвращает данные для запроса согласия оппонента.
 */
class CreateDirectMatch {
  /**
   * @param {Object} deps
   * @param {import("./RegisterSearch.js").RegisterSearch} deps.registerSearch
   * @param {QueueRepository} deps.repository
   * @param {QueueService} deps.queueService
   * @param {Messages} deps.messages
   * @param {Clock} [deps.clock]
   * @param {Logger} [deps.logger]
   */
  constructor({ registerSearch, repository, queueService, messages, clock, logger }) {
    this.registerSearch = registerSearch;
    this.repository = repository;
    this.queueService = queueService;
    this.messages = messages;
    this.clock = clock || { now: () => new Date() };
    this.logger = logger || createNullLogger();
  }

  /**
   * Подготовка ника оппонента: берем первое слово и гарантируем префикс @.
   * @param {string|undefined|null} opponent
   * @returns {string}
   */
  normalizeOpponent(opponent) {
    if (!opponent) return "";
    const [firstPart] = opponent.trim().split(/\s+/);
    if (!firstPart) return "";
    return firstPart.startsWith("@") ? firstPart : `@${firstPart}`;
  }

  /**
   * Готовит приглашение на матч между автором и оппонентом по нику.
   * @param {string|null} player Ник инициатора (с @).
   * @param {string|undefined|null} opponentRaw Строка с ником оппонента.
   * @returns {Promise<
   *   | { ok: true, text: string, invite: { player: string, opponent: string } }
   *   | { ok: false, reason: string, text: string }
   * >}
   */
  async execute(player, opponentRaw) {
    const opponent = this.normalizeOpponent(opponentRaw);

    if (!player) {
      this.logger.warn("Нельзя создать матч: у инициатора нет username");
      return { ok: false, reason: "username_required", text: this.messages.usernameRequired() };
    }

    if (!opponent) {
      this.logger.warn("Нельзя создать матч: не указан оппонент", { player });
      return { ok: false, reason: "opponent_required", text: this.messages.directOpponentRequired() };
    }

    const now = this.clock.now();
    const state = await this.repository.get();
    const { state: normalizedState } = this.queueService.normalizeState(state, now);
    await this.repository.save(normalizedState);

    if (normalizedState.isPlayed(opponent)) {
      this.logger.info("Прямое создание матча прервано: оппонент уже играл", {
        player,
        opponent,
      });
      return {
        ok: false,
        reason: "opponent_played",
        text: this.messages.directOpponentPlayed(opponent),
      };
    }

    const searchResult = await this.registerSearch.execute(player);
    if (!["added", "already_searching"].includes(searchResult.status)) {
      this.logger.info("Прямое создание матча прервано: игрок не в поиске", {
        player,
        status: searchResult.status,
      });
      return { ok: false, reason: searchResult.status, text: searchResult.text };
    }

    this.logger.info("Создано приглашение на прямой матч", { player, opponent });
    return {
      ok: true,
      invite: { player, opponent },
      text: this.messages.directInvite({ from: player, to: opponent }),
    };
  }
}

export { CreateDirectMatch };


