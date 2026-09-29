/**
 * Преобразует Telegram-ник в единый формат.
 * Символ @ необязателен.
 *
 * @param {string|undefined|null} username Telegram-ник.
 * @returns {string} Ник в нижнем регистре с префиксом @ или пустая строка.
 */
const normalizeTournamentPlayer = (username) => {
  const normalizedUsername = (username || "").trim().replace(/^@/, "").toLowerCase();
  return normalizedUsername ? `@${normalizedUsername}` : "";
};

/**
 * Преобразует список Telegram-ников из переменной окружения в единый формат.
 * Поддерживаются разделители-запятые и пробелы; символ @ необязателен.
 *
 * @param {string|undefined} value Значение TOURNAMENT_PLAYERS.
 * @returns {Set<string>} Ники в нижнем регистре с префиксом @.
 */
const getTournamentPlayers = (value = process.env.TOURNAMENT_PLAYERS) =>
  new Set(
    (value || "")
      .split(/[\s,]+/)
      .map(normalizeTournamentPlayer)
      .filter(Boolean)
  );

/**
 * Проверяет, что инициатор и приглашенный игрок могут создать турнирный матч.
 * Пустой ник оппонента допускается, чтобы команда вернула стандартную ошибку о нем.
 *
 * @param {Set<string>} tournamentPlayers Разрешенные участники турнира.
 * @param {string|undefined|null} player Ник инициатора.
 * @param {string|undefined|null} opponent Ник приглашенного игрока.
 * @returns {boolean}
 */
const canCreateTournamentMatch = (tournamentPlayers, player, opponent) => {
  const normalizedPlayer = normalizeTournamentPlayer(player);
  const normalizedOpponent = normalizeTournamentPlayer(opponent);

  if (!normalizedPlayer || !tournamentPlayers.has(normalizedPlayer)) return false;
  return !normalizedOpponent || tournamentPlayers.has(normalizedOpponent);
};

export { canCreateTournamentMatch, getTournamentPlayers, normalizeTournamentPlayer };
