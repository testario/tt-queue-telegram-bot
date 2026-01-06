const createRuMessages = ({ formatDate }) => ({
  greet: () =>
    `Приветствую!\nЯ бот для нормального управления очередью на игру в настольный теннис\n\nЧтобы мной пользоваться, напиши через @ мой ник в поле ввода сообщения и выбери нужный тебе пункт\n\nПриятной игры!`,
  searchAdded: (player) => `${player} хочет поиграть. Кто составит ему компанию?`,
  searchAlready: (player) => `Игрок ${player} попытался попасть в поиск, но он уже в поиске`,
  searchInQueue: (player) => `Игрок ${player} попытался попасть в поиск, но он уже в очереди`,
  searchPlayed: (player) => `Игрок ${player} попытался попасть в поиск, но он уже играл`,
  searchUnknown: (player) => `Ты как сюда попал, ${player}?`,
  searchCancelled: () => "Игрок передумал",
  directOpponentRequired: () => "Укажи ник оппонента, например /play @opponent",
  usernameRequired: () =>
    "Не удалось определить твой Telegram username. Установи его в настройках и повтори команду.",
  directInvite: ({ from, to }) =>
    `${from} приглашает ${to} на игру. Принять приглашение?`,
  directAccepted: ({ from, to }) =>
    `${to} принял приглашение от ${from}. Матч создан.`,
  directDeclined: ({ from, to }) =>
    `${to} отклонил приглашение от ${from}.`,
  directCancelled: ({ from, to }) => `${from} отменил приглашение для ${to}.`,
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
  matchStarted: ({ player1, player2 }) => `${player1} и ${player2} начали игру!`,
  matchFinished: ({ player1, player2 }) => `Игра между ${player1} и ${player2} окончена!`,
  matchFinishedWithNext: ({ finished, next }) =>
    `Игра между ${finished.player1} и ${finished.player2} окончена! Следующая пара ${next.player1} и ${next.player2} начинает игру.`,
  queueList: (queue) =>
    queue.length > 0
      ? "Очередь:\n\n" +
        queue.reduce(
          (current, next, index) =>
            (current += `Матч №${index + 1}\nИграют ${next.player1} и ${next.player2}\nДата начала - ${formatDate(
              next.startDate
            )}\nДата окончания - ${formatDate(next.endDate)}\n\n`),
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
  metricsAccessDenied: () => "Просмотр метрик доступен только из доверенного чата.",
  metricsDisabled: () => "Хранилище метрик не настроено. Добавьте METRICS_MONGODB_URI и перезапустите бота.",
  metricsEmpty: ({ from, to }) => {
    const fromText = from ? formatDate(from) : "не задан";
    const toText = to ? formatDate(to) : "не задан";
    return `Метрики за период ${fromText} — ${toText} отсутствуют.`;
  },
  metricsSummary: ({ from, to, total, byType, inlineVariants }) => {
    const fromText = from ? formatDate(from) : "начало";
    const toText = to ? formatDate(to) : "сейчас";
    const lines =
      byType && byType.length
        ? byType.map((item) => `• ${item.type}: ${item.count}`).join("\n")
        : "—";
    const inlinePart =
      inlineVariants && inlineVariants.length
        ? `\nInline выборы:\n${inlineVariants
            .map((item) => `• ${item.variant}: ${item.count}`)
            .join("\n")}`
        : "";
    return `Метрики за период ${fromText} — ${toText}\nВсего событий: ${total}\nПо типам:\n${lines}${inlinePart}`;
  },
  metricsRangeInvalid: () => "Неверный период. Используйте форматы 24h, 7d или 2w.",
  metricsUnavailable: () => "Не удалось получить метрики, попробуйте позже.",
});

const pluralizeTestMatches = (count) => (count === 1 ? "тестовый матч" : "тестовых матчей");

const createRuUi = () => ({
  commands: {
    start: "Запустить бота и привязать чат",
    play: "Пригласить соперника: /play @username",
    search: "Позвать соперника: /search",
    queue: "Показать очередь: /queue",
    played: "Кто уже играл: /played",
    metrics: "Сводка использования (только доверенный чат)",
    stop: "Остановить бота (админ)",
  },
  inline: {
    playWith: "Хочу сыграть с ним!",
    cancelOwn: "Я автор, хочу отменить",
    directAccept: "Принять",
    directDecline: "Отказаться",
    directCancel: "Отменить запрос",
    noChatBinding: {
      title: "Сначала нажми /start в чате",
      text: "Нужно открыть чат с ботом и отправить /start, чтобы привязать очередь к чату.",
      description: "Нет привязки к чату, команды недоступны",
    },
    contextNotReady: {
      title: "Контекст чата не готов",
      text: "Не удалось найти контекст чата, попробуйте снова или отправьте /start.",
      description: "Попробуйте заново",
    },
    search: {
      title: "Найти игрока",
      description: "Крикнуть на весь чат, как ты хочешь поиграть с кем-нибудь",
    },
    directTitle: (opponent) => `Пригласить ${opponent}`,
    directDescription: (opponent) => `Отправить приглашение игроку ${opponent}`,
    directPreview: (opponent) => `Отправляется приглашение для ${opponent}`,
    queue: {
      title: "Проверить очередь",
      description: "Можно посмотреть, кто ожидает игру и время последней игры",
    },
    played: {
      title: "Посмотреть тех, кто уже отыграл",
      description: "Проверить список отыгравших в текущей половине дня",
    },
    test: {
      createTitle: (count) => `Создать ${count} ${pluralizeTestMatches(count)}`,
      createText: (count) => `Создаю ${count} ${pluralizeTestMatches(count)}`,
      createDescription: (count) =>
        count === 1 ? "Генерация одного тестового матча" : `Быстро создать ${count} тестовых матчей`,
      createButton: "Создать",
    },
    confirmNoTime: "Нет времени на игры!",
  },
  callback: {
    startDialogRequired: "Нужно начать диалог с ботом в чате (/start), чтобы обрабатывать запросы.",
    contextMissing: "Контекст чата не готов, попробуйте отправить /start.",
    contextNotFound: "Контекст чата не найден",
    cancelNotAuthor: "Только автор может отменить заявку",
    cancelAlreadyRemoved: "Заявка уже была удалена",
    cancelForeignMatch: "Нельзя отменять чужие игры",
    matchNotFound: "Матч не найден",
    matchCancelled: "Матч отменен",
    testModeDisabled: "Тестовый режим отключен",
    directNotTarget: "Отвечать на приглашение может только указанный оппонент",
    directNotAuthor: "Отменить может только автор приглашения",
  },
  test: {
    playerName: ({ timestamp, index, suffix }) => `Тестовый_${timestamp}_${index}_${suffix}`,
    summary: (created) =>
      created.length > 0
        ? `Создано тестовых матчей: ${created.length}\n${created
            .map(({ searcher, opponent }, index) => `${index + 1}. ${searcher} vs ${opponent}`)
            .join("\n")}`
        : "Не удалось создать тестовые матчи",
  },
});

const ru = {
  code: "ru",
  dateLocale: "ru",
  createMessages: createRuMessages,
  createUi: createRuUi,
};

export { ru };

