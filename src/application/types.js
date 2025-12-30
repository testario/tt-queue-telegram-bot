/**
 * Общие JSDoc-типы для слоя application.
 * Выносятся отдельно, чтобы переиспользовать зависимости между use-case и сервисами.
 */

/**
 * @typedef {import("#domain/entities/QueueState.js").QueueState} QueueState
 * @typedef {import("#domain/entities/Match.js").Match} Match
 * @typedef {import("#domain/services/QueueService.js").QueueService} QueueService
 */

/**
 * @typedef {Object} QueueRepository
 * @property {() => Promise<QueueState>} get
 * @property {(state: QueueState) => Promise<void>} save
 */

/**
 * @typedef {Object} Timer
 * @property {(id: string, delay: number, callback: () => void) => void} schedule
 * @property {(id: string) => void} cancel
 * @property {() => void} cancelAll
 */

/**
 * @typedef {Object} Notifier
 * @property {(chatId: string|number, text: string) => void} notify
 */

/**
 * @typedef {Object} Clock
 * @property {() => Date} now
 */

/**
 * @typedef {Object} Logger
 * @property {(message: string, context?: Record<string, unknown>) => void} info
 * @property {(message: string, context?: Record<string, unknown>) => void} warn
 * @property {(message: string, context?: Record<string, unknown>) => void} error
 * @property {(message: string, context?: Record<string, unknown>) => void} debug
 * @property {(suffix: string) => Logger} [child]
 */

/**
 * @typedef {Object} MatchLifecycle
 * @property {(match: Match) => void} scheduleLifecycle
 * @property {(match: Match) => void} cancelForMatch
 */

/**
 * @typedef {Object} BotMessages
 * @property {() => string} greet
 * @property {(player: string) => string} searchAdded
 * @property {(player: string) => string} searchAlready
 * @property {(player: string) => string} searchInQueue
 * @property {(player: string) => string} searchPlayed
 * @property {(player: string) => string} searchUnknown
 * @property {() => string} searchCancelled
 * @property {(match: Match) => string} matchCreated
 * @property {() => string} matchAlreadyInQueue
 * @property {() => string} matchAlreadyPlayed
 * @property {() => string} matchPlayerNotSearching
 * @property {() => string} matchSamePlayer
 * @property {(match: Match) => string} matchStarted
 * @property {(payload: { finished: Match, next: Match }) => string} matchFinishedWithNext
 * @property {(match: Match) => string} matchFinished
 * @property {(match: Match) => string} nextPair
 * @property {(queue: Match[]) => string} queueList
 * @property {(played: string[]) => string} playedList
 * @property {(player: string) => string} cancelCurrent
 * @property {(player: string) => string} cancelWaiting
 * @property {() => string} botStopped
 */

export {};

