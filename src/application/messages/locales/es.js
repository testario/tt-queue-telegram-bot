const createEsMessages = ({ formatDate }) => ({
  greet: () =>
    `¡Bot activo y listo para trabajar!`,
  searchAdded: (player) => `${player} quiere jugar. ¿Quién se apunta?`,
  searchAlready: (player) => `El jugador ${player} ya está buscando oponente`,
  searchInQueue: (player) => `El jugador ${player} ya está en la cola`,
  searchPlayed: (player) => `El jugador ${player} ya jugó hoy`,
  searchUnknown: (player) => `¿Cómo llegaste aquí, ${player}?`,
  searchCancelled: () => "El jugador cambió de opinión",
  directOpponentRequired: () => "Indica el usuario del oponente, por ejemplo /play @opponent",
  usernameRequired: () =>
    "No pudimos detectar tu usuario de Telegram. Configúralo en tu perfil y vuelve a intentarlo.",
  directInvite: ({ from, to }) => `${from} invita a ${to} a jugar. ¿Aceptar partida?`,
  directAccepted: ({ from, to }) => `${to} aceptó la invitación de ${from}. Partido creado.`,
  directAcceptedShort: () => "Invitación aceptada",
  directDeclined: ({ from, to }) => `${to} rechazó la invitación de ${from}.`,
  directCancelled: ({ from, to }) => `${from} canceló la invitación para ${to}.`,
  matchCreated: ({ player1, player2, startDate, endDate }) =>
    `🏓 Partido creado entre ${player1} y ${player2}\n🔔 30 segundos para prepararse\n⌚️ Inicio - ${formatDate(
      startDate
    )}\n🔚 Fin - ${formatDate(endDate)}`,
  matchAlreadyInQueue: () => "Uno de los jugadores ya está jugando",
  matchAlreadyPlayed: () => "Ya jugaste hoy",
  matchPlayerNotSearching: () => "Este jugador no está buscando oponente",
  matchSamePlayer: () => "Puedes jugar contra la pared sin cola :)",
  nextPair: ({ player1, player2 }) =>
    `La siguiente pareja es ${player1} y ${player2}\n\nTienen 30 segundos para prepararse`,
  matchStarted: ({ player1, player2 }) => `${player1} y ${player2} comenzaron a jugar`,
  matchFinished: ({ player1, player2 }) => `¡La partida entre ${player1} y ${player2} terminó!`,
  matchFinishedWithNext: ({ finished, next }) =>
    `La partida entre ${finished.player1} y ${finished.player2} terminó. La siguiente pareja ${next.player1} y ${next.player2} comienza ahora.`,
  queueList: (queue) =>
    queue.length > 0
      ? "Cola:\n\n" +
        queue.reduce(
          (current, next, index) =>
            (current += `Partido nº${index + 1}\n${next.player1} vs ${next.player2}\nInicio - ${formatDate(
              next.startDate
            )}\nFin - ${formatDate(next.endDate)}\n\n`),
          ""
        )
      : "La cola está vacía",
  playedList: (played) =>
    played.length
      ? `Ya jugaron:\n${played.join("\n")}`
      : "Nadie ha jugado todavía, es momento de unirse a la cola",
  cancelCurrent: (player) =>
    `El jugador ${player} canceló, los siguientes partidos se mueven según el tiempo restante`,
  cancelWaiting: (player) => `El jugador ${player} canceló su turno`,
  botStopped: () =>
    "Bot detenido. Reinicia el proceso o envía /start después de que el servidor esté activo",
  adminOnly: () => "Este comando está disponible solo para administradores del chat.",
  pauseModeEnabled: () =>
    "Modo de pausa activado: puedes unirte a la cola, los partidos comenzarán después de /continue.",
  pauseModeAlreadyEnabled: () =>
    "El modo de pausa ya está activo. Envía /continue para iniciar la cola.",
  pauseModeDisabledNoQueue: () =>
    "Modo de pausa desactivado. La cola está vacía, no hay nada que iniciar.",
  pauseModeDisabled: ({ player1, player2, startDate }) =>
    `Modo de pausa desactivado. Primer partido: ${player1} vs ${player2}.\nInicio a ${formatDate(startDate)}.`,
  pauseModeOnHold: () => "La cola está en pausa: los partidos comenzarán después de /continue.",
  pauseModeNotEnabled: () => "El modo de pausa no está activo.",
});

const pluralizeTestMatches = (count) => (count === 1 ? "partido de prueba" : "partidos de prueba");

const createEsUi = () => ({
  commands: {
    start: "Iniciar el bot y vincular el chat",
    play: "Invitar a un oponente: /play @usuario",
    search: "Buscar oponente: /search",
    queue: "Mostrar la cola: /queue",
    played: "Quién ya jugó: /played",
    metrics: "Resumen de uso (solo chat confiable)",
    stop: "Detener el bot (admin)",
    pause: "Pausar el movimiento de la cola (admin)",
    continue: "Reanudar la cola tras la pausa (admin)",
  },
  inline: {
    playWith: "¡Quiero jugar!",
    cancelOwn: "Soy el autor, cancelar",
    directAccept: "Aceptar",
    directDecline: "Rechazar",
    directCancel: "Cancelar solicitud",
    noChatBinding: {
      title: "Primero pulsa /start en el chat",
      text: "Abre el chat con el bot y envía /start para vincular la cola.",
      description: "Sin vínculo al chat, comandos no disponibles",
    },
    contextNotReady: {
      title: "El contexto del chat no está listo",
      text: "No se pudo encontrar el contexto del chat, intenta de nuevo o envía /start.",
      description: "Intenta otra vez",
    },
    search: {
      title: "Buscar jugador",
      description: "Avísale al chat que quieres jugar con alguien",
    },
    directTitle: (opponent) => `Invitar a ${opponent}`,
    directDescription: (opponent) => `Enviar invitación a ${opponent}`,
    directPreview: (opponent) => `Enviando invitación a ${opponent}`,
    queue: {
      title: "Ver la cola",
      description: "Revisa quién espera y la hora del último juego",
    },
    played: {
      title: "Ver quién ya jugó",
      description: "Lista de jugadores que ya jugaron este medio día",
    },
    test: {
      createTitle: (count) => `Crear ${count} ${pluralizeTestMatches(count)}`,
      createText: (count) => `Creando ${count} ${pluralizeTestMatches(count)}`,
      createDescription: (count) =>
        count === 1 ? "Generar un partido de prueba" : `Crear rápidamente ${count} partidos de prueba`,
      createButton: "Crear",
    },
    confirmNoTime: "¡Sin tiempo para jugar!",
  },
  callback: {
    startDialogRequired: "Inicia un chat con el bot (/start) para procesar solicitudes.",
    contextMissing: "El contexto del chat no está listo, intenta /start.",
    contextNotFound: "Contexto del chat no encontrado",
    cancelNotAuthor: "Solo el autor puede cancelar la solicitud",
    cancelAlreadyRemoved: "La solicitud ya fue eliminada",
    cancelForeignMatch: "No puedes cancelar el partido de otro",
    matchNotFound: "Partido no encontrado",
    matchCancelled: "Partido cancelado",
    testModeDisabled: "El modo de prueba está desactivado",
    directNotTarget: "Solo el oponente invitado puede responder",
    directNotAuthor: "Solo el autor puede cancelar la invitación",
  },
  test: {
    playerName: ({ timestamp, index, suffix }) => `Prueba_${timestamp}_${index}_${suffix}`,
    summary: (created) =>
      created.length > 0
        ? `Partidos de prueba creados: ${created.length}\n${created
            .map(({ searcher, opponent }, index) => `${index + 1}. ${searcher} vs ${opponent}`)
            .join("\n")}`
        : "No se pudieron crear partidos de prueba",
  },
});

const es = {
  code: "es",
  dateLocale: "es",
  createMessages: createEsMessages,
  createUi: createEsUi,
};

export { es };

