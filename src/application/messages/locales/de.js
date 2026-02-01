import { stripAt, formatReadyTime } from "./utils.js";
import { TIME_AFTER_EMERGE, TIME_READY } from "#application/config/time.js";

const readyTimeText = formatReadyTime(TIME_READY, "de");
const afterEmergeText = formatReadyTime(TIME_AFTER_EMERGE, "de");

const createDeMessages = ({ formatDate }) => ({
  greet: () =>
    `Bot ist aktiv und bereit zum Einsatz!`,
  searchAdded: (player) => `${player} möchte spielen. Wer macht mit?`,
  searchAccepted: (player) => `${player} hat die Einladung zum Spiel akzeptiert. Match erstellt.`,
  searchAlready: (player) => `Spieler ${player} sucht bereits nach einem Gegner`,
  searchInQueue: (player) => `Spieler ${player} steht schon in der Warteschlange`,
  searchPlayed: (player) => `Spieler ${player} hat heute schon gespielt`,
  searchUnknown: (player) => `Wie bist du hierher gekommen, ${player}?`,
  searchCancelled: () => "Der Spieler hat seine Meinung geändert",
  directOpponentRequired: () => "Gib den Benutzernamen des Gegners an, z. B. /play @opponent",
  directOpponentPlayed: (opponent) => `${opponent} hat in dieser Tageshälfte schon gespielt`,
  usernameRequired: () =>
    "Dein Telegram-Username konnte nicht erkannt werden. Setze ihn in deinem Profil und versuche es erneut.",
  directInvite: ({ from, to }) => `${from} lädt ${to} zum Spiel ein. Einladung annehmen?`,
  directAccepted: ({ from, to }) => `${to} hat die Einladung von ${from} akzeptiert. Match erstellt.`,
  directAcceptedShort: () => "Einladung angenommen",
  directDeclined: ({ from, to }) => `${to} hat die Einladung von ${from} abgelehnt.`,
  directCancelled: ({ from, to }) => `${from} hat die Einladung für ${to} zurückgezogen.`,
  matchCreated: ({ player1, player2, startDate, endDate }) =>
    `🏓 Match erstellt zwischen ${player1} und ${player2}\n🔔 ${readyTimeText} zur Vorbereitung\n⌚️ Start - ${formatDate(
      startDate
    )}\n🔚 Ende - ${formatDate(endDate)}`,
  matchAlreadyInQueue: () => "Einer der Spieler spielt bereits",
  matchAlreadyPlayed: () => "Du hast heute schon gespielt",
  matchPlayerNotSearching: () => "Dieser Spieler sucht keinen Gegner",
  matchSamePlayer: () => "Gegen die Wand brauchst du keine Warteschlange :)",
  nextPair: ({ player1, player2 }) =>
    `Nächstes Paar: ${player1} und ${player2}\n\nEs gibt ${readyTimeText} zur Vorbereitung`,
  matchStarted: ({ player1, player2 }) => `${player1} und ${player2} haben begonnen`,
  matchFinished: ({ player1, player2 }) => `Das Spiel zwischen ${player1} und ${player2} ist beendet!`,
  matchFinishedWithNext: ({ finished, next }) =>
    `Das Spiel zwischen ${finished.player1} und ${finished.player2} ist beendet. Das nächste Paar ${next.player1} und ${next.player2} startet jetzt.`,
  queueList: (queue) =>
    queue.length > 0
      ? "Warteschlange:\n\n" +
        queue.reduce(
          (current, next, index) =>
            (current += `Match Nr.${index + 1}\n${stripAt(next.player1)} vs ${stripAt(
              next.player2
            )}\nStart - ${formatDate(next.startDate)}\nEnde - ${formatDate(next.endDate)}\n\n`),
          ""
        )
      : "Die Warteschlange ist leer",
  playedList: (played) =>
    played.length
      ? `Bereits gespielt:\n${played.map(stripAt).join("\n")}`
      : "Niemand hat bisher gespielt, Zeit sich anzustellen",
  cancelCurrent: (player) =>
    `Spieler ${player} hat storniert, nachfolgende Matches werden verschoben`,
  cancelWaiting: (player) => `Spieler ${player} hat die Anmeldung storniert`,
  botStopped: () => "Bot gestoppt. Starte den Prozess neu, um fortzufahren.",
  adminOnly: () => "Dieser Befehl ist nur für Chat-Administratoren verfügbar.",
  pauseModeEnabled: ({ action, player1, player2 }) => {
    const base =
      "Pausenmodus aktiviert: Du kannst dich anstellen. Weiter mit /continue.";
    if (action === "continue" && player1 && player2) {
      return `${base}\nDas aktuelle Match ${player1} vs ${player2} wird zu Ende gespielt.`;
    }
    if (action === "stop" && player1 && player2) {
      return `${base}\nMatch ${player1} vs ${player2} wurde gestoppt und startet nach /continue erneut.`;
    }
    return `${base}\nGerade kein aktives Match.`;
  },
  pauseModeAlreadyEnabled: () =>
    "Pausenmodus ist bereits aktiv. Starte die Warteschlange mit /continue.",
  emergePauseAlreadyEnabled: () =>
    "Pausenmodus ist bereits aktiv. Mit /continue fortsetzen.",
  pauseModeDisabledNoQueue: () =>
    "Pausenmodus deaktiviert. Die Warteschlange ist leer – nichts zu starten.",
  pauseModeDisabled: ({ player1, player2, startDate }) =>
    `Pausenmodus deaktiviert. Erstes Match: ${player1} vs ${player2}.\nStart um ${formatDate(startDate)}.`,
  pauseModeDisabledCurrent: ({ player1, player2, endDate }) =>
    `Pausenmodus deaktiviert. Match ${player1} vs ${player2} läuft weiter, Ende um ${formatDate(
      endDate
    )}.`,
  pauseModeOnHold: () => "Warteschlange pausiert: Starte sie mit /continue.",
  pauseModeNotEnabled: () => "Pausenmodus ist nicht aktiv.",
  emergePaused: ({ player1, player2 }) =>
    `Notfallpause. Zeit für das Match ${player1} vs ${player2} stoppen.`,
  emergeResumed: ({ player1, player2, remainingMinutes }) =>
    `Notfallpause beendet. Match ${player1} vs ${player2} geht weiter, ${remainingMinutes} Min. verbleiben.`,
  emergeTooLate: ({ player1, player2 }) =>
    `Notfallpause beendet, weniger als ${afterEmergeText} übrig — Match ${player1} vs ${player2} endet.`,
  emergeAlreadyActive: () => "Notfallpause ist bereits aktiv. Mit /continue fortsetzen.",
  emergeNoMatch: () => "Kein aktives Match für eine Pause.",
  emergeNotActive: () => "Notfallpause ist nicht mehr aktiv.",
});

const pluralizeTestMatches = (count) => (count === 1 ? "Testmatch" : "Testmatches");

const createDeUi = () => ({
  commands: {
    play: "Gegner einladen: /play @username",
    search: "Gegner suchen: /search",
    queue: "Warteschlange anzeigen: /queue",
    played: "Wer schon gespielt hat: /played",
    metrics: "Nutzungsstatistik (nur vertrauenswürdiger Chat)",
    stop: "Bot stoppen (Admin)",
    pause: "Warteschlange pausieren (Admin)",
    continue: "Warteschlange nach Pause starten (Admin)",
    emerge: "Notfallpause des Matches (Admin)",
  },
  inline: {
    playWith: "Ich will spielen!",
    cancelOwn: "Ich bin der Autor, abbrechen",
    directAccept: "Annehmen",
    directDecline: "Ablehnen",
    directCancel: "Anfrage abbrechen",
    noChatBinding: {
      title: "Bot ist nicht konfiguriert",
      text: "Die Warteschlange ist nur im Hauptchat verfügbar. Prüfe die Bot-Einstellungen.",
      description: "Chat nicht konfiguriert, Befehle nicht verfügbar",
    },
    contextNotReady: {
      title: "Chat-Kontext nicht bereit",
      text: "Chat-Kontext nicht gefunden, bitte erneut versuchen.",
      description: "Nochmal versuchen",
    },
    search: {
      title: "Spieler finden",
      description: "Sage dem Chat, dass du spielen möchtest",
    },
    directTitle: (opponent) => `${opponent} einladen`,
    directDescription: (opponent) => `Eine Einladung an ${opponent} senden`,
    directPreview: (opponent) => `Sende Einladung an ${opponent}`,
    queue: {
      title: "Warteschlange prüfen",
      description: "Sieh, wer wartet und wann zuletzt gespielt wurde",
    },
    played: {
      title: "Wer hat schon gespielt",
      description: "Liste der Spieler, die in diesem Halbtag gespielt haben",
    },
    emerge: {
      title: "Notfallpause",
      description: "Aktuelles Match pausieren oder fortsetzen",
      text: "Notfallpause: Zeit stoppen.",
    },
    test: {
      createTitle: (count) => `${count} ${pluralizeTestMatches(count)} erstellen`,
      createText: (count) => `Erstelle ${count} ${pluralizeTestMatches(count)}`,
      createDescription: (count) =>
        count === 1 ? "Ein Testmatch erzeugen" : `${count} Testmatches schnell erzeugen`,
      createButton: "Erstellen",
    },
    confirmNoTime: "Keine Zeit zum Spielen!",
  },
  callback: {
    startDialogRequired: "Dieser Befehl ist nur im Hauptchat verfügbar.",
    contextMissing: "Chat-Kontext nicht bereit, bitte später erneut versuchen.",
    contextNotFound: "Chat-Kontext nicht gefunden",
    cancelNotAuthor: "Nur der Autor kann die Anfrage abbrechen",
    cancelAlreadyRemoved: "Die Anfrage wurde bereits entfernt",
    cancelForeignMatch: "Du kannst nicht das Match eines anderen abbrechen",
    matchNotFound: "Match nicht gefunden",
    matchCancelled: "Match abgebrochen",
    testModeDisabled: "Testmodus ist deaktiviert",
    directNotTarget: "Nur der eingeladene Gegner kann antworten",
    directNotAuthor: "Nur der Autor kann die Einladung abbrechen",
  },
  test: {
    playerName: ({ timestamp, index, suffix }) => `Test_${timestamp}_${index}_${suffix}`,
    summary: (created) =>
      created.length > 0
        ? `Testmatches erstellt: ${created.length}\n${created
            .map(({ searcher, opponent }, index) => `${index + 1}. ${searcher} vs ${opponent}`)
            .join("\n")}`
        : "Testmatches konnten nicht erstellt werden",
  },
});

const de = {
  code: "de",
  dateLocale: "de",
  createMessages: createDeMessages,
  createUi: createDeUi,
};

export { de };

