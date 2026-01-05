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

/**
 * @typedef {Object} BotInlineUi
 * @property {string} playWith
 * @property {string} cancelOwn
 * @property {{ title: string, text: string, description: string }} noChatBinding
 * @property {{ title: string, text: string, description: string }} contextNotReady
 * @property {{ title: string, description: string }} search
 * @property {{ title: string, description: string }} queue
 * @property {{ title: string, description: string }} played
 * @property {{
 *   createTitle: (count: number) => string,
 *   createText: (count: number) => string,
 *   createDescription: (count: number) => string,
 *   createButton: string
 * }} test
 * @property {string} confirmNoTime
 */

/**
 * @typedef {Object} BotCallbackUi
 * @property {string} startDialogRequired
 * @property {string} contextMissing
 * @property {string} contextNotFound
 * @property {string} cancelNotAuthor
 * @property {string} cancelAlreadyRemoved
 * @property {string} cancelForeignMatch
 * @property {string} matchNotFound
 * @property {string} matchCancelled
 * @property {string} testModeDisabled
 */

/**
 * @typedef {Object} BotTestUi
 * @property {(params: { timestamp: number, index: number, suffix: string }) => string} playerName
 * @property {(created: Array<{ searcher: string, opponent: string }>) => string} summary
 */

/**
 * @typedef {Object} BotUi
 * @property {BotInlineUi} inline
 * @property {BotCallbackUi} callback
 * @property {BotTestUi} test
 */

/**
 * @typedef {Object} BotLocalization
 * @property {string} locale
 * @property {BotMessages} messages
 * @property {BotUi} ui
 */

/**
 * Поддерживаемые коды локалей.
 * @typedef {"ru"|"en"|"es"|"fr"|"de"} LocaleCode
 */

/**
 * Описание фабрики локали.
 * @typedef {Object} LocaleDefinition
 * @property {LocaleCode} code
 * @property {string} dateLocale
 * @property {(deps: { formatDate: (date: Date) => string }) => BotMessages} createMessages
 * @property {() => BotUi} createUi
 */

/**
 * Конфигурация создания локализации.
 * @typedef {Object} LocalizationConfig
 * @property {LocaleCode} [locale]
 * @property {LocaleCode} [fallbackLocale]
 */

/**
 * Результат фабрики локализации.
 * @typedef {Object} LocalizationResult
 * @property {LocaleCode} locale
 * @property {BotMessages} messages
 * @property {BotUi} ui
 */

export {};

