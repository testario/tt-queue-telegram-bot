import { Match } from '#domain'
import { createNullLogger } from '#infrastructure/logger/Logger.js'

const DEFAULT_INTERVAL_MS = 30_000

const matchFingerprint = (match) =>
  match
    ? [match.player1, match.player2, match.status, match.startDate.getTime(), match.endDate.getTime()].join(':')
    : null

/** Синхронизирует таймеры процесса бота с durable-состоянием очереди. */
export class LifecycleReconciler {
  constructor({ repository, orchestrator, clock, logger, shouldHold = () => false, intervalMs }) {
    this.repository = repository
    this.orchestrator = orchestrator
    this.clock = clock
    this.log = logger || createNullLogger()
    this.shouldHold = shouldHold
    this.intervalMs = intervalMs || DEFAULT_INTERVAL_MS
    this.lastFingerprint = null
    this.scheduledMatch = null
    this.running = null
    this.interval = null
    this.disposed = false
    this.generation = 0
    this.disposePromise = null
    this.orchestrator.setAsyncTaskHooks?.({
      onSettled: () => {
        if (!this.disposed) this.wake()
      },
      onRejected: () => {
        this.lastFingerprint = null
        if (!this.disposed) this.wake()
      },
    })
  }

  reconcile() {
    if (this.disposed) return Promise.resolve({ scheduled: false, disposed: true })
    const run = async () => this.reconcileNow()
    const next = (this.running || Promise.resolve()).then(run, run)
    this.running = next.catch(() => {})
    return next
  }

  async reconcileNow({ completedFingerprint = null } = {}) {
    if (this.disposed) return { scheduled: false, disposed: true }
    const generation = this.generation
    const state = await this.repository.get()
    if (this.disposed || generation !== this.generation) {
      return { scheduled: false, disposed: true }
    }
    const current = state.queue?.[0] || null

    if (!current) {
      this.cancelScheduledMatch()
      this.lastFingerprint = null
      return { scheduled: false, match: current }
    }

    const now = this.clock.now()
    if (completedFingerprint && completedFingerprint === matchFingerprint(current) && current.endDate <= now) {
      return { scheduled: false, expired: true, match: current }
    }
    if (current.status !== Match.statuses.playing || this.shouldHold(current, now)) {
      this.cancelScheduledMatch()
      this.lastFingerprint = null
      return { scheduled: false, held: true, match: current }
    }

    if (current.endDate <= now) {
      this.cancelScheduledMatch()
      this.lastFingerprint = null
      await this.orchestrator.handleMatchFinished(current, { scheduleNext: false })
      if (this.disposed || generation !== this.generation) {
        return { scheduled: false, disposed: true }
      }
      return this.reconcileNow({ completedFingerprint: matchFingerprint(current) })
    }

    const fingerprint = matchFingerprint(current)
    if (fingerprint === this.lastFingerprint) {
      return { scheduled: true, deduplicated: true, match: current }
    }

    this.cancelScheduledMatch()
    if (this.disposed || generation !== this.generation) {
      return { scheduled: false, disposed: true }
    }
    if (current.status === Match.statuses.playing && current.startDate <= now) {
      this.orchestrator.scheduleFinish(current, { scheduleNext: false })
    } else {
      this.orchestrator.scheduleLifecycle(current, { scheduleNext: false })
    }
    this.scheduledMatch = current
    this.lastFingerprint = fingerprint
    return { scheduled: true, match: current }
  }

  cancelScheduledMatch() {
    if (this.scheduledMatch) this.orchestrator.cancelForMatch(this.scheduledMatch)
    this.scheduledMatch = null
  }

  wake() {
    return this.reconcile().catch((error) => {
      this.log.error('Ошибка reconciliation lifecycle', { message: error.message })
    })
  }

  start() {
    if (this.disposed) return
    this.stop()
    this.interval = setInterval(() => this.wake(), this.intervalMs)
    this.interval.unref?.()
  }

  stop() {
    if (this.interval) clearInterval(this.interval)
    this.interval = null
  }

  async dispose() {
    if (this.disposePromise) return this.disposePromise

    this.disposed = true
    this.generation += 1
    this.stop()
    this.cancelScheduledMatch()
    this.lastFingerprint = null

    const running = this.running
    this.disposePromise = Promise.resolve(running)
      .catch((error) => {
        this.log.error('Ошибка завершения lifecycle reconciliation', { message: error.message })
      })
      .then(() => {
        return this.orchestrator.dispose?.()
      })
      .catch((error) => {
        this.log.error('Ошибка drain lifecycle timer tasks', { message: error.message })
      })
      .then(() => {
        this.cancelScheduledMatch()
        this.stop()
      })
    return this.disposePromise
  }
}
