const createFrMessages = ({ formatDate }) => ({
  greet: () =>
    `Salut !\nJe suis un bot pour gérer la file de ping-pong.\n\nMentionne-moi avec @ dans le chat et choisis l’option dont tu as besoin.\n\nBonne partie !`,
  searchAdded: (player) => `${player} veut jouer. Qui se joint ?`,
  searchAlready: (player) => `Le joueur ${player} cherche déjà un adversaire`,
  searchInQueue: (player) => `Le joueur ${player} est déjà dans la file`,
  searchPlayed: (player) => `Le joueur ${player} a déjà joué aujourd’hui`,
  searchUnknown: (player) => `Comment es-tu arrivé ici, ${player} ?`,
  searchCancelled: () => "Le joueur a changé d’avis",
  matchCreated: ({ player1, player2, startDate, endDate }) =>
    `🏓 Match créé entre ${player1} et ${player2}\n🔔 30 secondes pour se préparer\n⌚️ Début - ${formatDate(
      startDate
    )}\n🔚 Fin - ${formatDate(endDate)}`,
  matchAlreadyInQueue: () => "Un des joueurs joue déjà",
  matchAlreadyPlayed: () => "Tu as déjà joué aujourd’hui",
  matchPlayerNotSearching: () => "Ce joueur ne cherche pas d’adversaire",
  matchSamePlayer: () => "Tu peux jouer contre le mur sans file :)",
  nextPair: ({ player1, player2 }) =>
    `Prochaine paire : ${player1} et ${player2}\n\n30 secondes pour se préparer`,
  matchStarted: ({ player1, player2 }) => `${player1} et ${player2} ont commencé à jouer`,
  matchFinished: ({ player1, player2 }) => `Le match entre ${player1} et ${player2} est terminé !`,
  matchFinishedWithNext: ({ finished, next }) =>
    `Le match entre ${finished.player1} et ${finished.player2} est terminé. La prochaine paire ${next.player1} et ${next.player2} commence maintenant.`,
  queueList: (queue) =>
    queue.length > 0
      ? "File :\n\n" +
        queue.reduce(
          (current, next, index) =>
            (current += `Match n°${index + 1}\n${next.player1} vs ${next.player2}\nDébut - ${formatDate(
              next.startDate
            )}\nFin - ${formatDate(next.endDate)}\n\n`),
          ""
        )
      : "La file est vide",
  playedList: (played) =>
    played.length
      ? `Ont déjà joué :\n${played.join("\n")}`
      : "Personne n’a encore joué, il est temps d’entrer dans la file",
  cancelCurrent: (player) =>
    `Le joueur ${player} a annulé, les prochains matchs sont décalés selon le temps restant`,
  cancelWaiting: (player) => `Le joueur ${player} a annulé son inscription`,
  botStopped: () =>
    "Bot arrêté. Redémarre le processus ou envoie /start après le démarrage du serveur",
});

const pluralizeTestMatches = (count) => (count === 1 ? "match de test" : "matchs de test");

const createFrUi = () => ({
  inline: {
    playWith: "Je veux jouer !",
    cancelOwn: "Je suis l’auteur, annuler",
    noChatBinding: {
      title: "Commence par /start dans le chat",
      text: "Ouvre le chat avec le bot et envoie /start pour lier la file.",
      description: "Pas de liaison au chat, commandes indisponibles",
    },
    contextNotReady: {
      title: "Contexte du chat indisponible",
      text: "Impossible de trouver le contexte du chat, réessaie ou envoie /start.",
      description: "Réessaie",
    },
    search: {
      title: "Trouver un joueur",
      description: "Annonce au chat que tu veux jouer",
    },
    queue: {
      title: "Voir la file",
      description: "Voir qui attend et l’heure du dernier match",
    },
    played: {
      title: "Voir qui a déjà joué",
      description: "Liste des joueurs qui ont joué ce demi-jour",
    },
    test: {
      createTitle: (count) => `Créer ${count} ${pluralizeTestMatches(count)}`,
      createText: (count) => `Création de ${count} ${pluralizeTestMatches(count)}`,
      createDescription: (count) =>
        count === 1 ? "Générer un match de test" : `Créer rapidement ${count} matchs de test`,
      createButton: "Créer",
    },
    confirmNoTime: "Pas le temps de jouer !",
  },
  callback: {
    startDialogRequired: "Commence un chat avec le bot (/start) pour traiter les requêtes.",
    contextMissing: "Contexte du chat indisponible, réessaie /start.",
    contextNotFound: "Contexte du chat introuvable",
    cancelNotAuthor: "Seul l’auteur peut annuler la requête",
    cancelAlreadyRemoved: "La requête a déjà été supprimée",
    cancelForeignMatch: "Tu ne peux pas annuler le match de quelqu’un d’autre",
    matchNotFound: "Match introuvable",
    matchCancelled: "Match annulé",
    testModeDisabled: "Mode test désactivé",
  },
  test: {
    playerName: ({ timestamp, index, suffix }) => `Test_${timestamp}_${index}_${suffix}`,
    summary: (created) =>
      created.length > 0
        ? `Matchs de test créés : ${created.length}\n${created
            .map(({ searcher, opponent }, index) => `${index + 1}. ${searcher} vs ${opponent}`)
            .join("\n")}`
        : "Impossible de créer des matchs de test",
  },
});

const fr = {
  code: "fr",
  dateLocale: "fr",
  createMessages: createFrMessages,
  createUi: createFrUi,
};

export { fr };

