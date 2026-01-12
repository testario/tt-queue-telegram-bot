import { stripAt, formatReadyTime } from "./utils.js";
import { TIME_READY } from "#application/config/time.js";

const readyTimeText = formatReadyTime(TIME_READY, "en");

const createEnMessages = ({ formatDate }) => ({
  greet: () =>
    `Bot is active and ready to work!`,
  searchAdded: (player) => `${player} wants to play. Who will join?`,
  searchAlready: (player) => `Player ${player} tried to search, but is already searching`,
  searchInQueue: (player) => `Player ${player} tried to search, but is already in queue`,
  searchPlayed: (player) => `Player ${player} tried to search, but has already played today`,
  searchUnknown: (player) => `How did you get here, ${player}?`,
  searchCancelled: () => "Player changed their mind",
  directOpponentRequired: () => "Specify opponent username, e.g. /play @opponent",
  usernameRequired: () =>
    "Could not detect your Telegram username. Set it in your profile and retry.",
  directInvite: ({ from, to }) => `${from} invites ${to} to play. Accept the match?`,
  directAccepted: ({ from, to }) => `${to} accepted the invite from ${from}. Match created.`,
  directAcceptedShort: () => "Invitation accepted",
  directDeclined: ({ from, to }) => `${to} declined the invite from ${from}.`,
  directCancelled: ({ from, to }) => `${from} cancelled the invite for ${to}.`,
  matchCreated: ({ player1, player2, startDate, endDate }) =>
    `🏓 Match created between ${player1} and ${player2}\n🔔 ${readyTimeText} to get ready\n⌚️ Start time - ${formatDate(
      startDate
    )}\n🔚 End time - ${formatDate(endDate)}`,
  matchAlreadyInQueue: () => "One of the players is already playing right now",
  matchAlreadyPlayed: () => "You already played today",
  matchPlayerNotSearching: () => "This player is not looking for an opponent",
  matchSamePlayer: () => "You can play against the wall without a queue :)",
  nextPair: ({ player1, player2 }) =>
    `Next pair is ${player1} and ${player2}\n\nYou have ${readyTimeText} to prepare`,
  matchStarted: ({ player1, player2 }) => `${player1} and ${player2} started the game!`,
  matchFinished: ({ player1, player2 }) => `Game between ${player1} and ${player2} is finished!`,
  matchFinishedWithNext: ({ finished, next }) =>
    `Game between ${finished.player1} and ${finished.player2} is finished! Next pair ${next.player1} and ${next.player2} starts now.`,
  queueList: (queue) =>
    queue.length > 0
      ? "Queue:\n\n" +
      queue.reduce(
        (current, next, index) =>
        (current += `Match #${index + 1}\n${stripAt(next.player1)} vs ${stripAt(
          next.player2
        )}\nStart - ${formatDate(next.startDate)}\nEnd - ${formatDate(next.endDate)}\n\n`),
        ""
      )
      : "Queue is empty",
  playedList: (played) =>
    played.length
      ? `Players who already played: \n${played.map(stripAt).join("\n")}`
      : "No one has played yet, time to queue up",
  cancelCurrent: (player) =>
    `Player ${player} canceled, next pairs are shifted by the remaining time`,
  cancelWaiting: (player) => `Player ${player} canceled the entry`,
  botStopped: () =>
    "Bot stopped. Restart the process or send /start after the server is up",
  adminOnly: () => "This command is available to chat administrators only.",
  pauseModeEnabled: () =>
    "Pause mode enabled: you can queue up, matches will start after /continue.",
  pauseModeAlreadyEnabled: () =>
    "Pause mode is already active. Send /continue to start the queue.",
  pauseModeDisabledNoQueue: () => "Pause mode disabled. Queue is empty, nothing to start.",
  pauseModeDisabled: ({ player1, player2, startDate }) =>
    `Pause mode disabled. First match: ${player1} vs ${player2}.\nStart at ${formatDate(startDate)}.`,
  pauseModeOnHold: () => "Queue is on hold: matches will start after /continue.",
  pauseModeNotEnabled: () => "Pause mode is not active.",
});

const pluralizeTestMatches = (count) => (count === 1 ? "test match" : "test matches");

const createEnUi = () => ({
  commands: {
    start: "Start the bot and bind chat",
    play: "Invite an opponent: /play @username",
    search: "Call for an opponent: /search",
    queue: "Show the queue: /queue",
    played: "Who already played: /played",
    metrics: "Usage metrics (trusted chat only)",
    stop: "Stop the bot (admin)",
    pause: "Pause queue movement (admin)",
    continue: "Resume queue after pause (admin)",
  },
  inline: {
    playWith: "I want to play!",
    cancelOwn: "I'm the author, cancel",
    directAccept: "Accept",
    directDecline: "Decline",
    directCancel: "Cancel request",
    noChatBinding: {
      title: "Press /start in chat first",
      text: "Open the chat with the bot and send /start to bind the queue to the chat.",
      description: "No chat binding, commands are unavailable",
    },
    contextNotReady: {
      title: "Chat context is not ready",
      text: "Could not find the chat context, try again or send /start.",
      description: "Try again",
    },
    search: {
      title: "Find a player",
      description: "Shout to the chat that you want to play with someone",
    },
    directTitle: (opponent) => `Invite ${opponent}`,
    directDescription: (opponent) => `Send an invite to ${opponent}`,
    directPreview: (opponent) => `Sending an invite to ${opponent}`,
    queue: {
      title: "Check queue",
      description: "See who is waiting and the time of the last game",
    },
    played: {
      title: "See who already played",
      description: "Check the list of players who played this half-day",
    },
    test: {
      createTitle: (count) => `Create ${count} ${pluralizeTestMatches(count)}`,
      createText: (count) => `Creating ${count} ${pluralizeTestMatches(count)}`,
      createDescription: (count) =>
        count === 1 ? "Generate one test match" : `Quickly create ${count} test matches`,
      createButton: "Create",
    },
    confirmNoTime: "No time for games!",
  },
  callback: {
    startDialogRequired: "Start a chat with the bot (/start) to handle requests.",
    contextMissing: "Chat context is not ready, try /start again.",
    contextNotFound: "Chat context was not found",
    cancelNotAuthor: "Only the author can cancel the request",
    cancelAlreadyRemoved: "The request was already removed",
    cancelForeignMatch: "You can't cancel someone else's match",
    matchNotFound: "Match not found",
    matchCancelled: "Match cancelled",
    testModeDisabled: "Test mode is disabled",
    directNotTarget: "Only the invited opponent can respond",
    directNotAuthor: "Only the author can cancel the invite",
  },
  test: {
    playerName: ({ timestamp, index, suffix }) => `Test_${timestamp}_${index}_${suffix}`,
    summary: (created) =>
      created.length > 0
        ? `Test matches created: ${created.length}\n${created
            .map(({ searcher, opponent }, index) => `${index + 1}. ${searcher} vs ${opponent}`)
            .join("\n")}`
        : "Failed to create test matches",
  },
});

const en = {
  code: "en",
  dateLocale: "en",
  createMessages: createEnMessages,
  createUi: createEnUi,
};

export { en };

