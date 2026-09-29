# Atomic player identity

## Goal
Guarantee that a banned Telegram user cannot enter a new match through stale usernames, including username transfer/reuse, while keeping direct-invite private-message fallback behavior intact.

## Accepted decision
User approved the full protection model on 2026-09-17. Rollout may clear legacy queue, search, and match state because ownership cannot be proved for those records.

## Evidence and architecture
- Existing queue CAS and player Mongo state are separate; Mongo pre/post validation with compensation is not safe.
- Oracle plan (`ora-2`): store Redis ownership mirror with fencing generation in QueueState. Player identity claim is reserve (queue CAS) → persist Mongo → activate (queue CAS). Matches/searches carry immutable `{ userId, generation }` tokens and acceptance validates only the active mirror inside queue CAS.
- Legacy state is cleared idempotently during schema migration before polling/HTTP begin.

## Phases
1. **Identity state and claim path** — QueueState v2 ownership mirror, migration, ClaimPlayerIdentity wiring, repository generation persistence. Owner: fixer. Gate: oracle (module/state invariant).
2. **Queue and invite fencing** — searches, invites, direct accept, AddMatch use identity tokens; remove compensating Mongo validation. Owner: fixer. Gate: oracle (no stale durable match).
3. **Integration and validation** — bot/web registration/handlers, lifecycle recovery, migration coverage and full test/build. Owner: fixer. Gate: oracle (release behavior).

## Validation budget
- Phase tests focused on QueueState/ClaimPlayerIdentity/AddMatch and bot/web routes.
- Full: `npm test -- --runInBand`, `npm run build:webapp`, `git diff --check`.
- Oracle after each phase; maximum two re-reviews per gate.

## Current status
Phase 1 implemented by `fix-1`:
- QueueState v2 identity mirror and `ClaimPlayerIdentity` are in place.
- Legacy pre-v2 queue/search/played/matches are cleared once before handlers and timer recovery.
- Evidence: targeted 5 suites / 22 tests; full 30 suites / 186 tests; `git diff --check`.
- Gate 1 pending: review state invariants, migration ordering, and claim failure behavior before Phase 2.

Structure scan (`exp-2`): domain QueueState has no outward imports; Claim/Migrate use cases sit in application. Runtime wiring intentionally remains pending for Phase 2. Existing logger import from application to infrastructure is a pre-existing layering pattern and is not expanded in this delivery.

Gate 1 attempt 1 blocked on identity invariants: generation must be global and exact-token activation must not depend on global epoch; renames must tombstone old usernames; Mongo claim/detach must use generation CAS; migration requires a documented coordinated stop of all old writers. Runtime handler wiring is explicitly Phase 2 scope, not a Phase 1 release artifact.

Gate 1 remediation by `fix-1`: global generations, exact pending activation, per-user rename tombstones, repository generation CAS/final confirmation, and high-generation migration seeding were added. Coordinated rollout/no-rollback procedure is documented in `docs/deploy-vps-dev.md` and `docs/architecture.md`. Evidence: targeted 5 suites/26 tests; full 30 suites/190 tests; `git diff --check`. Gate 1 review attempt 2 pending.

Gate 1 attempt 2 found one race: an active retry could return success without rechecking its exact queue token after a competing reserve. Final remediation must run exact activation/check after Mongo persist even for an initially active reservation; the regression test must pause persistence and reserve a competing owner.

Final remediation evidence from `fix-1`: idempotent exact activation now reports `save: false`; targeted/full backend tests pass (30 suites/191 tests) and `git diff --check` passes. Gate 1 review attempt 3 pending.

Gate 1 approved by `ora-2`: exact post-persist activation rejects superseded tokens and idempotently confirms the same active tuple. Phase 2 may now wire claims and fence all queue/invite actions against the active QueueState ownership mirror.

Phase 2 implementation by `fix-1`: Web/Telegram claim tokens were propagated into queue/direct-invite flows; new invites require identity generations; direct-invite DM uses the stored opponent token; migration restores persisted ownership claims. Evidence: full backend 30 suites/196 tests (`--silent`) and `git diff --check`. Gate 2 pending: prove all match acceptance paths fence tokens inside QueueState CAS and reject legacy/stale data without side effects.

Phase 2 structure scan (`exp-3`): shared runtime composition is present. It flagged a Web dev fallback that fabricates an identity token and legacy invite fallback representations; Gate 2 must classify and address these. Existing application→logger and web→Telegram imports are pre-existing layering patterns and not a state-safety blocker.

Gate 2 attempt 1 blocked: AddMatch/Search had fail-open tokenless paths; stale cleanup was username-wide; CancelSearch discarded its token; direct create used Mongo instead of active mirror for opponent; invite storage synthesised legacy identities. Remediation must make every new action require exact active tokens and reject/remove tokenless legacy state without side effects.

Gate 2 remediation by `fix-1`: strict search/match token fences and token-specific stale cleanup were added; Web/Telegram fixtures use real test identities; full backend remains 30 suites/196 tests; Mini App build and diff check pass. Gate 2 review attempt 2 pending.

Gate 2 attempt 2 found token substitution (active token lacked equality with its username map key) and raw dev/test state writes. Final remediation must enforce `token.username === operation username` everywhere and route dev/test identity setup/actions through the same reserve/activate and token-aware application APIs.

Final Gate 2 remediation by `fix-1`: username-bound exact active tokens are enforced for queue mutations; dev/test setup uses a shared ClaimPlayerIdentity-backed helper. Evidence: 31 suites/201 tests, Mini App build, and `git diff --check` pass. Gate 2 review attempt 3 pending.

Gate 2 approved by `ora-2`: all search/cancel/match/invite paths bind exact active tokens and dev/test flows use ClaimPlayerIdentity. Phase 3 is integration/release validation: deployment docs, API compatibility, full validation, and release-behavior gate.

Phase 3 validation by `fix-1`: deployment/architecture/OpenAPI and direct-invite behavior were verified without changes. Evidence: 31 suites/201 tests, Mini App build, and `git diff --check` pass. Release constraint: coordinated v2 rollout stops every old writer and clears legacy queue/search/played/matches; v2 Redis state cannot be rolled back to old binaries. Gate 3 pending.

Gate 3 attempt 1 blocked: raw queue/invite/player entities leak identity tokens and user IDs through public state/SSE/player list payloads. Remediation must project explicit public DTOs and test token absence before release.

Gate 3 remediation by `fix-1`: explicit public match/invite/player/state DTOs now project REST and SSE output; OpenAPI and regression tests were added. Evidence: 31 suites/203 tests, Mini App build, and `git diff --check` pass. Gate 3 review attempt 2 pending.

Gate 3 approved by `ora-2`: no public internal-token leakage or contract regressions remain. Deepwork complete. Final evidence: 31 suites/203 tests, Mini App production build, and `git diff --check` pass. Deployment remains a coordinated v2 rollout that stops all writers and clears unverifiable legacy queue/search/played/matches.
