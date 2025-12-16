import { TIME_OPTIONS } from "../config/time.js";

const formatDate = (date) => date.toLocaleString("ru", TIME_OPTIONS);

const templates = {
  greet: () =>
    `Приветствую!\nЯ бот для нормального управления очередью на игру в настольный теннис\n\nЧтобы мной пользоваться, напиши через @ мой ник в поле ввода сообщения и выбери нужный тебе пункт\n\nПриятной игры!`,
  searchAdded: (player) => `${player} хочет поиграть. Кто составит ему компанию?`,
  searchAlready: (player) =>
    `Игрок ${player} попытался попасть в поиск, но он уже в поиске`,
  searchInQueue: (player) =>
    `Игрок ${player} попытался попасть в поиск, но он уже в очереди`,
  searchPlayed: (player) =>
    `Игрок ${player} попытался попасть в поиск, но он уже играл`,
  searchUnknown: (player) => `Ты как сюда попал, ${player}?`,
  searchCancelled: () => "Игрок передумал",
  matchCreated: ({ player1, player2, startDate, endDate }) =>
    `🏓 Создан матч между ${player1} и ${player2}\n🔔 Дается 30 секунд на подготовку\n⌚️ Время начала - ${formatDate(
      startDate
    )}\n🔚 Время окончания - ${formatDate(endDate)}`,
  matchAlreadyInQueue: () => "Один из игроков уже играет прямо сейчас",
  matchAlreadyPlayed: () => "Ты уже играл сегодня",
  matchPlayerNotSearching: () => "Этот игрок больше не ищет соперника",
  matchSamePlayer: () => "От стеночки можно поиграть и без очереди :)",
  nextPair: ({ player1, player2 }) =>
    `Следующая пара игроков - ${player1} и ${player2}\n\nНа подготовку дается 30 секунд`,
  matchStarted: ({ player1, player2 }) =>
    `${player1} и ${player2} начали игру!`,
  matchFinished: ({ player1, player2 }) =>
    `Игра между ${player1} и ${player2} окончена!`,
  matchFinishedWithNext: ({ finished, next }) =>
    `Игра между ${finished.player1} и ${finished.player2} окончена! Следующая пара ${next.player1} и ${next.player2} начинает игру.`,
  queueList: (queue) =>
    queue.length > 0
      ? queue.reduce(
          (current, next, index) =>
            (current += `Матч №${index + 1}\nИграют ${next.player1} и ${
              next.player2
            }\nДата начала - ${formatDate(next.startDate)}\nДата окончания - ${formatDate(
              next.endDate
            )}\n\n`),
          ""
        )
      : "Очередь пуста",
  playedList: (played) =>
    played.length
      ? `Отыгравшие игроки: \n${played.join("\n")}`
      : "Еще никто не играл, самое время встать в очередь",
  cancelCurrent: (player) =>
    `Игрок ${player} отменил запись, время следующих пар игроков сдвигается на оставшееся время`,
  cancelWaiting: (player) => `Игрок ${player} отменил запись`,
  botStopped: () =>
    "Бот остановлен. Для повторного запуска перезапустите процесс или выполните /start после запуска сервера",
};

export { templates };

