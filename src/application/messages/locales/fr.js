const createFrMessages = ({ formatDate }) => ({
  greet: () =>
    `Bot actif et prêt à travailler !`,
  searchAdded: (player) => `${player} veut jouer. Qui se joint ?`,
  searchAlready: (player) => `Le joueur ${player} cherche déjà un adversaire`,
  searchInQueue: (player) => `Le joueur ${player} est déjà dans la file`,
  searchPlayed: (player) => `Le joueur ${player} a déjà joué aujourd’hui`,
  searchUnknown: (player) => `Comment es-tu arrivé ici, ${player} ?`,
  searchCancelled: () => "Le joueur a changé d’avis",
  directOpponentRequired: () => "Indique le pseudo de l’adversaire, par ex. /play @opponent",
  usernameRequired: () =>
    "Impossible de détecter ton nom d’utilisateur Telegram. Renseigne-le dans ton profil et réessaie.",
  directInvite: ({ from, to }) => `${from} invite ${to} à jouer. Accepter le match ?`,
  directAccepted: ({ from, to }) => `${to} a accepté l’invitation de ${from}. Match créé.`,
  directAcceptedShort: () => "Invitation acceptée",
  directDeclined: ({ from, to }) => `${to} a refusé l’invitation de ${from}.`,
  directCancelled: ({ from, to }) => `${from} a annulé l’invitation pour ${to}.`,
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
  adminOnly: () => "Cette commande est réservée aux administrateurs du chat.",
  pauseModeEnabled: () =>
    "Mode pause activé : on peut rejoindre la file, les matchs démarreront après /continue.",
  pauseModeAlreadyEnabled: () =>
    "Le mode pause est déjà actif. Envoie /continue pour lancer la file.",
  pauseModeDisabledNoQueue: () =>
    "Mode pause désactivé. La file est vide, rien à lancer.",
  pauseModeDisabled: ({ player1, player2, startDate }) =>
    `Mode pause désactivé. Premier match : ${player1} vs ${player2}.\nDébut à ${formatDate(startDate)}.`,
  pauseModeOnHold: () => "File en pause : les matchs commenceront après /continue.",
  pauseModeNotEnabled: () => "Le mode pause n'est pas actif.",
});

const pluralizeTestMatches = (count) => (count === 1 ? "match de test" : "matchs de test");

const createFrUi = () => ({
  commands: {
    start: "Démarrer le bot et lier le chat",
    play: "Inviter un adversaire : /play @pseudo",
    search: "Chercher un adversaire : /search",
    queue: "Afficher la file : /queue",
    played: "Qui a déjà joué : /played",
    metrics: "Résumé d'usage (chat de confiance uniquement)",
    stop: "Arrêter le bot (admin)",
    pause: "Mettre la file en pause (admin)",
    continue: "Relancer la file après pause (admin)",
  },
  inline: {
    playWith: "Je veux jouer !",
    cancelOwn: "Je suis l’auteur, annuler",
    directAccept: "Accepter",
    directDecline: "Refuser",
    directCancel: "Annuler la demande",
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
    directTitle: (opponent) => `Inviter ${opponent}`,
    directDescription: (opponent) => `Envoyer une invitation à ${opponent}`,
    directPreview: (opponent) => `Envoi d’une invitation à ${opponent}`,
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
    directNotTarget: "Seul l’adversaire invité peut répondre",
    directNotAuthor: "Seul l’auteur peut annuler l’invitation",
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

