# Alpha hardening

## Goal

Resolve alpha-test failures in player registration, Mini App/bot synchronization, direct-match actions, lifecycle reliability, and stale announcements.

## Evidence

- Initial exploration: player registration is absent on `/start` and Mini App authentication; split bot lacked a shared player repository.
- Review gates identified invite replay, Pub/Sub-only lifecycle reliance, stale lifecycle writes, pause handling, and shutdown defects.
- Current full verification: `npm test -- --runInBand` (20 suites, 108 tests) and `npm run build:webapp` pass after lifecycle/ownership integration.

## Delivery plan

1. **State-consistency foundation** — @fixer: revision-based queue CAS and guarded match completion; tests for concurrent unrelated queue change and status change. Gate: @oracle, because this protects queue data integrity.
2. **Lifecycle and ownership integration** — @fixer: pause-aware reconciler, safe disposal, local announcement ownership, `/stop`/signal resource cleanup. Gate: @oracle, because this coordinates split-process runtime behavior.
3. Run the full verification path and report remaining operational limitations.

## Decision log

- Redis queue state remains the durable source of truth. Pub/Sub is only a wake-up/SSE mechanism; no new dependency or durable outbox is introduced.
- Direct invitations use the v2 atomic invite contract and short IDs; visual Mini App structure is unchanged.
- Exactly-once Telegram delivery across a process crash between send and acknowledgement remains out of scope without a durable outbound-message outbox.

## Phase 1 evidence

- Queue repositories now expose versioned reads and whole-state revision CAS; Redis keeps revision in a durable companion key and treats legacy state as revision 0.
- Match completion validates the exact current playing head and performs a revision CAS before notifying or scheduling the next match.
- Changed paths: `src/application/types.js`, `src/infrastructure/repositories/RedisQueueRepository.js`, `src/infrastructure/repositories/InMemoryQueueRepository.js`, `src/application/services/MatchOrchestrator.js`, `src/__tests__/infra.test.js`, `src/__tests__/redisQueueRepository.test.js`, `src/__tests__/matchOrchestrator.test.js`.
- Focused verification: repository and orchestrator tests pass (15 tests).
- Full verification: `npm test -- --runInBand` passes (19 suites, 97 tests).
- Remediation added bounded CAS retries for every normal queue writer, complete in-memory clone isolation, and deferred reconciliation after exhausted lifecycle CAS retries.
- Final Phase 1 gate (attempt 3/3): clean. Full suite after remediation: 19 suites, 103 tests.

## Phase 2 review limit

- Phase 2 used its initial review and both permitted re-reviews. The final gate still found material defects in all-in-one `resumeQueueAfterPause` composition, local pause flags changed before failed CAS, cancellation while `holdNextMatch` is set, scheduling after orchestrator disposal, and the depth of ownership/shutdown integration coverage.
- Work is paused pending explicit authorization for an exceptional remediation and a further review gate.
- User authorized the exceptional remediation and one additional focused review gate.

## Completion

- Independent final review verdict: both material findings resolved (`clean`).
- Cosmetic surfacing gap closed directly: backend pause/resume return `{ hasQueue: false, conflict: true }` on exhausted CAS conflicts; `/api/admin/pause` and `/api/admin/continue` surface `{ ok: false, reason: 'conflict' }` instead of a misleading success.
- Final verification: `npm test -- --runInBand` — 25 suites, 127 tests passed; `npm run build:webapp` — passed; `git diff --check` — clean.

## Accepted limitations

- Exactly-once Telegram delivery across a process crash between `sendMessage` and durable acknowledgement remains out of scope (would require a durable outbox).
- Minor: `RedisInvitesStore.consume` degrades safely on corrupted hash state; `GetPlayed` bumps revision even on no-op normalization.

## Phase 1 remediation evidence

- Normal queue read-modify-write use cases now use versioned reads and bounded three-attempt `saveIfRevision` retries; unconditional `save` is not used in these paths.
- Match completion retries stale CAS conflicts only while the exact playing head remains current; notifications and lifecycle scheduling happen only after a successful CAS.
- In-memory repository now clones state at all read/write boundaries, including `getVersioned` and CAS saves.
- Regression coverage includes use-case CAS retry, orchestrator CAS retry without duplicate notification, and caller-mutation isolation.
- Focused verification: 6 suites, 28 tests pass.
- Full verification: `npm test -- --runInBand` passes (19 suites, 100 tests).

## Phase 1 final remediation evidence (gate attempt 3/3)

- After exhausting bounded finish CAS attempts, `MatchOrchestrator` re-reads the queue and schedules one delayed reconciliation only for the unchanged exact playing head. The deferred callback revalidates the head, uses the same CAS guard, and never emits duplicate notifications; changed or non-playing heads receive no timer.
- `GetPlayed` now uses the shared three-attempt versioned CAS helper, so normalization cannot overwrite a concurrent lifecycle completion.
- Added regression coverage for deferred reconciliation, changed-head timer suppression, and `GetPlayed` conflict preservation.
- Focused verification: 7 suites, 33 tests pass.
- Full verification: `npm test -- --runInBand` passes (19 suites, 103 tests).

## Phase 2 evidence

- `LifecycleReconciler` now applies per-match `shouldHold(match, now)` semantics: waiting/empty heads are held without scheduling, continuing playing matches retain finish timers, and only expired playing matches are completed. Expired completion uses `scheduleNext: false`; the active reconciler rereads and schedules the next head.
- Reconciler disposal is async and idempotent: it invalidates in-flight generations, stops polling intervals, cancels timers, drains active repository/completion work, and performs a final timer cleanup.
- Telegram announcement ownership is local to the creator process. Bot and backend local notifiers send match-created announcements; Redis events only trigger lifecycle/SSE wakeups and no longer forward Telegram announcements remotely.
- `createBot` exposes idempotent `dispose` and `onDispose`; `/stop` invokes the same disposal path. Bot signal shutdown awaits bot/reconciler disposal and closes Redis and players resources. All-in-one and backend entrypoints close owned web app, buses, Redis, and players resources on signals.
- `MongoPlayersRepository.close()` is idempotent and safe for concurrent calls.
- Added regression coverage for pause continuation/holding, expired waiting heads, disposal during reads/completion, GetPlayed/lifecycle integration, and Mongo close idempotence.
- Focused verification: `npm test -- --runInBand src/__tests__/lifecycleReconciler.test.js src/__tests__/getters.usecases.test.js src/__tests__/mongoPlayersRepository.test.js src/__tests__/webapp.router.test.js` — 4 suites, 19 tests pass.
- Full verification: `npm test -- --runInBand` — 20 suites, 108 tests pass.
- Web verification: `npm run build:webapp` passes.

## Phase 2 remediation evidence (gate re-review attempt 2/3)

- `LifecycleReconciler` now registers async work created by `MatchOrchestrator` timer callbacks, drains it during async disposal, and prevents unhandled timer rejections. Disposal invalidates ingress first, cancels interval/timers, then drains in-flight work.
- Backend-only pause writes the durable queue according to the continuation threshold: an ineligible current head becomes `waiting`, while an eligible current remains `playing`; a state-update wakeup is published for the bot reconciler.
- Restart recovery now ignores both future and expired waiting heads; only playing heads are scheduled or completed.
- `/stop` and signal paths use idempotent owner-level shutdown, stop polling before lifecycle drain, close owned resources, and remove the bot health marker. All-in-one shutdown awaits WebApp resolution and closes its app before exit.
- Announcement ownership remains local: bot-created and backend-created match announcements each have one local send attempt; Redis remains wakeup/SSE-only and preserves the no-durable-outbox limitation.
- Added regression coverage for timer-fired disposal drain, backend pause threshold behavior, waiting-head recovery, local announcement ownership, and resource close idempotence.
- Focused verification: 7 suites, 19 tests pass.
- Full verification: `npm test -- --runInBand` passes (24 suites, 116 tests).
- Web verification: `npm run build:webapp` passes.

## Phase 2 final remediation evidence (gate attempt 3/3)

- `MatchOrchestrator` now owns every async task started by lifecycle timers, including deferred finish retries. It cancels timers before draining and performs a final `cancelAll` after drain; rejected tasks are safely logged and notify the active reconciler to clear dedupe state and wake again.
- `LifecycleReconciler` integrates with orchestrator task hooks and disposal, while all-in-one bot contexts drain their orchestrators before owned resources close.
- Pause continuation is durable via `QueueState.holdNextMatch`: backend pause updates it through versioned CAS retry, continuation-eligible current matches remain playing, and completion consumes the flag while keeping the next head waiting.
- All-in-one startup defers polling until shutdown handlers, recovery, and WebApp initialization are prepared. `/stop` and signals use the owner shutdown path without TDZ or duplicate exit behavior; WebApp is closed after its startup promise resolves.
- Replaced ownership checks with public bot/backend-context integration coverage proving one local announcement attempt per creator and no Redis echo send. The no-durable-outbox limitation remains unchanged.
- Added rejection, deferred-retry disposal, durable pause race, waiting recovery, queue hold, and shutdown regressions.
- Focused verification: 9 suites, 48 tests pass.
- Full verification: `npm test -- --runInBand` passes (24 suites, 120 tests).
- Web verification: `npm run build:webapp` passes.

## Phase 2 exceptional remediation evidence (final-gate findings)

- All-in-one `index.js` now passes `resumeQueueAfterPause` into `createWebApp`; public `createWebApp` composition coverage exercises `/api/admin/continue` and verifies the dependency is invoked.
- Backend pause/resume local flags are changed only after a successful versioned CAS write. Exhausted conflict tests prove process-local pause state and durable queue state remain unchanged.
- `QueueService.cancelMatch` consumes `holdNextMatch` when removing the current match, leaves the next head waiting, and returns no promoted lifecycle match; dedicated queue regression coverage was added.
- `MatchOrchestrator.scheduleLifecycle`/`scheduleFinish` reject new work after disposal, and start callbacks recheck disposal before scheduling finish work. Disposal revival coverage was added.
- Public `createBot` ownership coverage now verifies one local announcement attempt, polling-before-lifecycle close order, and idempotent `/stop`; backend announcement coverage remains Redis-echo negative coverage.
- Focused verification: `npm test -- --runInBand src/__tests__/backendPause.test.js src/__tests__/queueService.test.js src/__tests__/matchOrchestrator.test.js src/__tests__/webapp.composition.test.js src/__tests__/botOwnershipShutdown.test.js src/__tests__/announcementOwnership.test.js` — 6 suites, 39 tests pass.
- Full verification: `npm test -- --runInBand` — 25 suites, 125 tests pass.
- Web verification: `npm run build:webapp` passes.

## Phase 2 CAS and callback-hardening evidence (final independent review)

- Bot pause paths now use the versioned CAS helper `updateQueueState` instead of unguarded get+save: `freezeQueueForPause` (`bot_pause`), `resumeQueueAfterPause` (`bot_resume_queue`), and the emerge resume in `resumeEmergeAfterContinue` (`bot_resume_emerge`). `QueueStateConflictError` is exported from `queueStateCas.js` for typed handling.
- Local `setPauseMode` flags change only after a successful CAS write, mirroring backend behavior. `orchestrator.cancelAll()` in freeze runs only after a successful save. Exhausted conflicts log via `log.error` and leave local flags and durable state untouched; `applyPauseMode` answers with a friendly retry alert, `resumeQueueAfterPause` returns `{ hasQueue: false, conflict: true }`, and `/continue` surfaces the retry alert instead of a misleading "no queue" message.
- The `callback_query` handler body is extracted into `handleCallbackQuery` and wrapped in try/catch that logs via `log.error` and answers the callback with a friendly retry alert (`ui.callback.actionFailed`, added to all locales). This catches `QueueStateConflictError` from CAS-based usecases so concurrent actions can never crash the bot process via unhandled rejection.
- Regression coverage: a one-shot conflicting repository injects a concurrent direct-accept (real `addMatch.execute`) into the first `/pause` CAS attempt — the retry wins, the accepted match survives in the durable queue, and the stale pre-accept snapshot is not saved; a callback path that exhausts 3 CAS attempts answers the alert and resolves without crashing.
- Focused verification: `npm test -- --runInBand src/__tests__/botOwnershipShutdown.test.js src/__tests__/backendPause.test.js src/__tests__/cancelMatch.usecase.test.js src/__tests__/search.usecases.test.js src/__tests__/getters.usecases.test.js src/__tests__/addMatch.usecase.test.js src/__tests__/createDirectMatch.usecase.test.js` — 7 suites, 28 tests pass.
- Full verification: `npm test -- --runInBand` — 25 suites, 127 tests pass.
- Web verification: `npm run build:webapp` passes.

## Direct-invite TTL evidence (15-minute expiry)

- Both invite stores (`RedisInvitesStore`, `InMemoryInvitesStore`) now persist `expiresAt = createdAt + ttlMs` on every new invite; default TTL is exactly 15 minutes (`DEFAULT_INVITE_TTL_MS`), with injectable `ttlMs` and `now` clock for deterministic tests. The v2 key/contract (`queue:invites:v2`, record shape) is preserved; `expiresAt` is an additive field.
- `create` atomically discards an expired (or legacy, i.e. `expiresAt`-less) existing invite for the same player before deciding `invite_exists`, so a stale invite no longer blocks a new one. Redis does this in Lua alongside index writes.
- `consume`, `getByPlayer`, and `getAll` treat expired entries as absent and purge all indexes (records/by-player/players/opponents plus a new `:expires` lookup hash used for numeric Lua comparisons, avoiding `cjson` in scripts). The Redis consume performs authorization + expiry cleanup atomically in Lua; the in-memory store mirrors the semantics. A wrong-actor consume of an expired invite purges it without touching a newer invite.
- Expired callback/action outcomes are unchanged: `consume` returns `null` → existing `invite_not_found` stale alert, no queue mutation. `getAll` never exposes expired or legacy records (mixed live/expired/legacy covered).
- Tests: parity contract suite covers default TTL value, boundary expiry (`expiresAt - 1` live, `expiresAt` expired), expired-permits-new-create, expired consume not authorizing/removing a newer invite, mixed getAll filter+purge with legacy seeding, and injectable short `ttlMs`; router tests updated to realistic `createdAt` (previous fixed `createdAt: 1` now correctly counts as expired).
- Focused verification: `npm test -- --runInBand src/__tests__/invitesStore.test.js src/__tests__/webapp.router.test.js` — 2 suites, 29 tests pass.
- Full verification: `npm test -- --runInBand` — 25 suites, 141 tests pass.
