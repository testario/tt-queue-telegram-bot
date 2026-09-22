/**
 * Функция для получения целочисленного значения из переменной окружения.
 * @param {string} varName - Имя переменной окружения.
 * @param {number} defaultValue - Значение по умолчанию.
 * @returns {number} - Целочисленное значение из переменной окружения или значение по умолчанию.
 */
function getEnvInt(varName, defaultValue) {
  const value = process.env[varName];
  return value !== undefined && !isNaN(Number(value)) ? parseInt(value, 10) : defaultValue;
}

export const TIME_OPTIONS = {
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
};
export const DEFAULT_GAME_TIME = getEnvInt("DEFAULT_GAME_TIME", 15) * 60 * 1000;
export const TIME_READY = getEnvInt("TIME_READY", 30) * 1000;
export const TIME_AFTER_EMERGE = getEnvInt("TIME_AFTER_EMERGE", 3) * 60 * 1000;
// Если текущий матч идёт дольше этого порога на момент /pause, его доигрывают
// вместо немедленной остановки. Общий порог для all-in-one (bot.js) и
// backend-only (webapp/index.js) режимов, чтобы поведение не расходилось.
export const PAUSE_CANCEL_MATCH_MS = 5 * 60 * 1000;
// Сообщение "Доступ к мини-аппу открыт" самоудаляется из общего чата через
// этот интервал, чтобы не спамить чат подтверждениями регистрации.
export const REGISTRATION_CONFIRMED_TTL_MS = 5 * 1000;

export const WORK_SCHEDULE = {
  workStart: {
    hour: getEnvInt("WORK_START_HOUR", 10),
    minute: getEnvInt("WORK_START_MINUTE", 0),
  },
  lunchStart: {
    hour: getEnvInt("LUNCH_START_HOUR", 14),
    minute: getEnvInt("LUNCH_START_MINUTE", 0),
  },
  lunchDurationMinutes: getEnvInt("LUNCH_DURATION_MINUTES", 60),
  workEnd: {
    hour: getEnvInt("WORK_END_HOUR", 19),
    minute: getEnvInt("WORK_END_MINUTE", 0),
  },
};

