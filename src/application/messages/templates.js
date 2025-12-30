import { TIME_OPTIONS } from "../config/time.js";

/**
 * Преобразует дату к строке в локали ru по настроенным опциям времени.
 * @param {Date} date
 * @returns {string}
 */
const formatDate = (date) => date.toLocaleString("ru", TIME_OPTIONS);

const templates = {
  /**
   * Приветствие и инструкция по использованию бота.
   * @returns {string}
   */
  greet: () =>
    `Приветствую!\nЯ бот для нормального управления очередью на игру в настольный теннис\n\nЧтобы мной пользоваться, напиши через @ мой ник в поле ввода сообщения и выбери нужный тебе пункт\n\nПриятной игры!`,
  /**
   * Сообщение о постановке игрока в поиск соперника.
   * @param {string} player
   * @returns {string}
   */
  searchAdded: (player) => `${player} хочет поиграть. Кто составит ему компанию?`,
  /**
   * Сообщение, если игрок уже находится в поиске.
   * @param {string} player
   * @returns {string}
   */
  searchAlready: (player) =>
    `Игрок ${player} попытался попасть в поиск, но он уже в поиске`,
  /**
   * Сообщение, если игрок уже стоит в очереди.
   * @param {string} player
   * @returns {string}
   */
  searchInQueue: (player) =>
    `Игрок ${player} попытался попасть в поиск, но он уже в очереди`,
  /**
   * Сообщение, если игрок уже играл сегодня.
   * @param {string} player
   * @returns {string}
   */
  searchPlayed: (player) =>
    `Игрок ${player} попытался попасть в поиск, но он уже играл`,
  /**
   * Сообщение по умолчанию для неизвестного состояния игрока.
   * @param {string} player
   * @returns {string}
   */
  searchUnknown: (player) => `Ты как сюда попал, ${player}?`,
  /**
   * Подтверждение отмены поиска.
   * @returns {string}
   */
  searchCancelled: () => "Игрок передумал",
  /**
   * Сообщение о создании матча с временными метками.
   * @param {Object} payload
   * @param {string} payload.player1
   * @param {string} payload.player2
   * @param {Date} payload.startDate
   * @param {Date} payload.endDate
   * @returns {string}
   */
  matchCreated: ({ player1, player2, startDate, endDate }) =>
    `🏓 Создан матч между ${player1} и ${player2}\n🔔 Дается 30 секунд на подготовку\n⌚️ Время начала - ${formatDate(
      startDate
    )}\n🔚 Время окончания - ${formatDate(endDate)}`,
  /**
   * Ошибка, если один из игроков уже играет.
   * @returns {string}
   */
  matchAlreadyInQueue: () => "Один из игроков уже играет прямо сейчас",
  /**
   * Ошибка, если игрок уже сыграл сегодня.
   * @returns {string}
   */
  matchAlreadyPlayed: () => "Ты уже играл сегодня",
  /**
   * Ошибка, если соперник больше не ищет игру.
   * @returns {string}
   */
  matchPlayerNotSearching: () => "Этот игрок больше не ищет соперника",
  /**
   * Ошибка, если выбран один и тот же игрок.
   * @returns {string}
   */
  matchSamePlayer: () => "От стеночки можно поиграть и без очереди :)",
  /**
   * Уведомление о следующей паре игроков.
   * @param {Object} payload
   * @param {string} payload.player1
   * @param {string} payload.player2
   * @returns {string}
   */
  nextPair: ({ player1, player2 }) =>
    `Следующая пара игроков - ${player1} и ${player2}\n\nНа подготовку дается 30 секунд`,
  /**
   * Уведомление о старте матча.
   * @param {Object} payload
   * @param {string} payload.player1
   * @param {string} payload.player2
   * @returns {string}
   */
  matchStarted: ({ player1, player2 }) =>
    `${player1} и ${player2} начали игру!`,
  /**
   * Уведомление о завершении матча.
   * @param {Object} payload
   * @param {string} payload.player1
   * @param {string} payload.player2
   * @returns {string}
   */
  matchFinished: ({ player1, player2 }) =>
    `Игра между ${player1} и ${player2} окончена!`,
  /**
   * Уведомление о завершении матча с объявлением следующей пары.
   * @param {Object} payload
   * @param {Object} payload.finished
   * @param {string} payload.finished.player1
   * @param {string} payload.finished.player2
   * @param {Object} payload.next
   * @param {string} payload.next.player1
   * @param {string} payload.next.player2
   * @returns {string}
   */
  matchFinishedWithNext: ({ finished, next }) =>
    `Игра между ${finished.player1} и ${finished.player2} окончена! Следующая пара ${next.player1} и ${next.player2} начинает игру.`,
  /**
   * Формирует список очереди или сообщает об отсутствии матчей.
   * @param {Array<{player1: string, player2: string, startDate: Date, endDate: Date}>} queue
   * @returns {string}
   */
  queueList: (queue) =>
    queue.length > 0
      ? "Очередь:\n\n" + queue.reduce(
          (current, next, index) =>
            (current += `Матч №${index + 1}\nИграют ${next.player1} и ${
              next.player2
            }\nДата начала - ${formatDate(next.startDate)}\nДата окончания - ${formatDate(
              next.endDate
            )}\n\n`),
          ""
        )
      : "Очередь пуста",
  /**
   * Формирует список сыгравших игроков или сообщает, что игр ещё не было.
   * @param {string[]} played
   * @returns {string}
   */
  playedList: (played) =>
    played.length
      ? `Отыгравшие игроки: \n${played.join("\n")}`
      : "Еще никто не играл, самое время встать в очередь",
  /**
   * Сообщение об отмене текущего матча с пересчётом расписания.
   * @param {string} player
   * @returns {string}
   */
  cancelCurrent: (player) =>
    `Игрок ${player} отменил запись, время следующих пар игроков сдвигается на оставшееся время`,
  /**
   * Сообщение об отмене ожидания в очереди.
   * @param {string} player
   * @returns {string}
   */
  cancelWaiting: (player) => `Игрок ${player} отменил запись`,
  /**
   * Уведомление о штатной остановке бота.
   * @returns {string}
   */
  botStopped: () =>
    "Бот остановлен. Для повторного запуска перезапустите процесс или выполните /start после запуска сервера",
};

export { templates };

