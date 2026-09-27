## Validation: service-robustness (catalog) — PASS with open items

# Service Robustness (catalog) Validation

**Date**: 2026-09-26
**Spec**: `processing-catalog/.specs/features/service-robustness/spec.md`
**Diff range**: `a2901ad..ca4ee0f` (T1-T3), branch `fix/service-robustness`
**Verifier**: independent sub-agent (author != verifier). Final round: leftovers are open items for "Validar depois".

---

## Task Completion

| Task | Status | Notes |
| --- | --- | --- |
| T1 | Done | `parsePositiveMs` + zero-timeout relay e2e |
| T2 | Done | `isValidAttemptId` shared by Started/Completed/Failed; `String()` removed |
| T3 | Done | Lock-release e2e, Fail-order unit, MSG-03 note, `isUnchanged` comment |

---

## Spec-Anchored Acceptance Criteria

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| ROB-01 AC1: `0` / negative | 5000 | `src/infrastructure/rabbitmq/rabbitmq.connection.spec.ts:65` `['zero','0',5000]`, `:67-68` `-1`,`-5` -> 5000 | PASS |
| ROB-01 AC2: unset / blank / NaN | 5000 | `rabbitmq.connection.spec.ts:62-63,69` (`''`, `'  '`, `'abc'`) | PASS |
| ROB-01 AC3: positive integer | that value | `rabbitmq.connection.spec.ts:66` `'250'` -> 250 | PASS |
| ROB-01 AC4: silent broker, timeout `0` | returns within 5000 ms, row pending | `test/outbox-relay.e2e-spec.ts:389-402` real `RabbitMQConnection` at `amqp://127.0.0.1:1` (beforeEach `:353-359`); `rejects.toThrow('timeout')`, `4_500 <= elapsed < 7_000`, `pendingIds() == [row]` | PASS |
| ROB-01: backoff `0` -> 0 unchanged | 0 | `settle-failed-message.spec.ts:123`; `settle-failed-message.ts` not in diff | PASS |
| ROB-02 AC1: missing/null/number/empty/blank on Started, Failed | nack(requeue=false), use case not called, state kept | `src/infrastructure/rabbitmq/lifecycle-consumers.spec.ts:98-104` table; Started `:339-376` (`nack(message,false,false)` `:367`, `execute` not called, QUEUED, not recorded); Failed `:535-572` (PROCESSING, no terminal event) | PASS |
| ROB-02 AC2: same rule in all three | shared `isValidAttemptId` | `src/infrastructure/rabbitmq/attempt-id.ts:7-9`, used in the 3 consumers; Completed table `processing-completed.consumer.spec.ts:202-238` (+`1` at `:207`); `hasAttemptId` deleted | PASS |
| ROB-02 AC3: valid stale id | ack, no-op | Started `lifecycle-consumers.spec.ts:379-404` (recorded as processed); Failed `:575-600`; Completed `processing-completed.consumer.spec.ts:242-263` | PASS |
| ROB-02 edge: `attemptId: 1` not coerced | rejected | all three tables include `1`; no `String(payload.attemptId)` left in `src/` | PASS |
| ROB-03 AC1: lock released after drain | B drains rows added later | `test/outbox-relay.e2e-spec.ts:299-322` A drains 1, then B (other DataSource) `drain()==3`, publishes exactly those ids, nothing pending | PASS |
| ROB-03 AC2: racing stale redelivery | one record, state kept | `src/application/fail-processing-request.use-case.spec.ts:391-420` pre-lock check forced to miss; `markEventProcessed` not called, returned/stored == snapshot, no outbox entry | PASS |
| ROB-03 AC3: MSG-03 `RECEIVED` note | written | `.specs/features/catalog-messaging-hardening/spec.md:80` | PASS |
| ROB-03 AC4: comment above `isUnchanged` | moved | `src/domain/processing-request.ts:108-113` | PASS |

**Status**: all ACs covered. One spec-precision gap (no upper bound on the timeout, see F-A).

Prior findings closed: **F1** (zero timeout) closed by ROB-01; **F2** (presence-only `attemptId`) closed by ROB-02; **M01b** and **M05d** are now killed (below).

---

## Discrimination Sensor

Scratch `git worktree` at `ca4ee0f` under the scratchpad (node_modules symlinked), own PostgreSQL `spf-catver-pg` on 55448. Each mutant was applied, the suites were run, and the file was restored with `git checkout` inside the worktree. The real tree's `git status --porcelain` was empty before and after.

| # | File | Mutation | Result |
| --- | --- | --- | --- |
| R1 | `rabbitmq.connection.ts:58` | `configured > 0` -> `>= 0` (parsePositiveMs accepts 0) | Killed (unit 1; e2e: zero-timeout case red) |
| R2 | `rabbitmq.connection.ts:58` | drop `Number.isFinite(configured) &&` | **SURVIVED** (see F-B) |
| A1 | `attempt-id.ts:8` | also accept `typeof value === 'number'` | Killed (3: numeric case in each consumer) |
| A2 | `attempt-id.ts:8` | no `trim()` | Killed (3) |
| A3 | `attempt-id.ts:8` | accept `null` | Killed (3) |
| C1 | `processing-started.consumer.ts` | presence-only check + `String()` restored | Killed (4) |
| C2 | `processing-failed.consumer.ts` | presence-only check + `String()` restored | Killed (4) |
| C3 | `processing-completed.consumer.ts` | skip the rule (`if (false)`) | Killed (5) |
| C4 | `attempt-id.ts` + Started | rule becomes `String(value)` non-blank, `String()` restored | Killed (6) |
| C5 | `processing-failed.consumer.ts` | skip the rule | Killed (5) |
| M01b | `outbox-relay.ts:58` | `pg_try_advisory_xact_lock` -> `pg_try_advisory_lock` | Killed (e2e 2, incl. the new lock-release test) |
| M05d | `fail-processing-request.use-case.ts:86-102` | stale check before the under-lock dedup | Killed (unit 1: the new order test) |

**Sensor depth**: P0-style manual (12 mutants).
**Result**: 11/12 killed. 1 survivor (R2), code correct, test gap only.

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code | OK |
| Surgical changes | OK (14 files, only in scope) |
| No scope creep | OK |
| Matches patterns | OK (`settleFailedMessage` classification reused; `ProcessingRequestDomainError` -> DLQ) |
| Spec-anchored asserted values | OK |
| Every test maps to a requirement | OK |
| Existing tests weakened | No. Only 4 test lines removed: `'0' -> 0` flipped to `'0' -> 5000` as ROB-01 AC1 requires (plus `-5` added); Completed's expected message `'Invalid ProcessingCompleted payload'` -> `'attemptId is required'` with the same `nack(false,false)`, no-ack, no-execute and no-terminal-event assertions, plus a new `1` case |

---

## Edge Cases

- [x] `"  "` -> 5000 (`rabbitmq.connection.spec.ts:63`)
- [x] `attemptId: 1` rejected, not `"1"` (all three consumers)
- [x] `"Infinity"`, `"1e309"` -> 5000 in code (`Number.isFinite`), but untested (F-B)
- [ ] Huge values (`>= 2^31`) or fractional values: not handled, see F-A

---

## Gate Check

- **Gate command**: `npm run lint && npm run typecheck && npm test && DATABASE_HOST=localhost DATABASE_PORT=55448 npm run test:e2e && npm run build` (run in the scratch worktree at `ca4ee0f`)
- **Result**: lint OK, typecheck OK, unit 245 passed / 27 suites, e2e 173 passed / 16 suites, build OK. 0 failed, 0 skipped (`DATABASE_HOST` set, so no `describe.skip`).
- **Delta**: unit 229 -> 245 (+16), e2e 171 -> 173 (+2), matching tasks.md.

---

## Findings / Open items (for "Validar depois")

### F-A (Low-Medium, spec-precision): no upper bound on `OUTBOX_PUBLISH_TIMEOUT_MS`
- **Code**: `src/infrastructure/rabbitmq/rabbitmq.connection.ts:58` accepts any finite positive number. `amqp-connection-manager` passes it to `setTimeout` (`ChannelWrapper.js:198-213`).
- **Node behaviour (verified)**: a delay above 2147483647 ms triggers `TimeoutOverflowWarning` and is **set to 1 ms**. Fractions such as `0.4` are also clamped to 1 ms.
- **Failure scenario A (`1e12`)**: every publish times out after ~1 ms, usually before the broker's confirm arrives, even though the message was already sent. The row stays pending, so each tick republishes the same event. The relay makes no progress and floods duplicates, which consumers must dedup. So `1e12` is not "no timeout"; it is the opposite, a near-zero timeout.
- **Failure scenario B (`2147483647`)**: the timeout is 24.8 days. With a silent broker the drain hangs and `draining` blocks every tick for weeks, which is V5's stall in practice.
- **Against the spec**: AC3 says a positive integer is used as-is, so the code conforms, but the goal "no value lets a publish wait forever" holds only literally. AC3 also says "integer" while fractions are accepted.
- **Suggestion**: treat values above a sane ceiling (for example 60000, or at least 2147483647) and non-integers as invalid -> 5000, or clamp; add unit cases `'1e12'`, `'2147483648'`, `'0.4'`.

### F-B (Low, test gap; survivor R2): `Infinity` / `1e309` are not pinned
- **Code**: `rabbitmq.connection.ts:58` correctly rejects them through `Number.isFinite`, but removing that check passes every test.
- **Failure scenario**: a refactor drops `isFinite`; `"Infinity"` reaches `setTimeout(Infinity)`, which Node clamps to 1 ms, giving F-A scenario A (republish loop) with no red test.
- **Suggestion**: add `['infinity','Infinity',5000]` and `['overflow','1e309',5000]` to `rabbitmq.connection.spec.ts:61-70`.

### F-C (Cosmetic): the Failed stale test does not assert the event was recorded
- `lifecycle-consumers.spec.ts:575-600` checks ack, state and no terminal event, but not `hasEventBeenProcessed('failed-stale') === true`, which the Started twin does (`:401-403`). MSG-03 says the stale event is recorded. The use-case spec covers it, so this is not a gap in behaviour coverage.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| --- | --- | --- |
| ROB-01 | Implementing | Verified (open items F-A, F-B) |
| ROB-02 | Implementing | Verified |
| ROB-03 | Implementing | Verified |

(Not written into `spec.md`: the Verifier does not modify the real tree.)

---

## Summary

**Overall**: Ready, with open items.
**Spec-anchored check**: 13/13 ACs matched; 1 spec-precision gap (F-A).
**Sensor**: 11/12 killed; survivor R2 (test gap only).
**Gate**: 418 passed (245 unit + 173 e2e), 0 skipped; lint, typecheck and build OK.

**What works**: 0, negative, blank and non-numeric timeouts fall back to 5000, proven end-to-end against an unreachable broker. The single `attemptId` rule dead-letters `null`, number, empty, blank and missing values on all three consumers without reaching the use case. A valid stale id is still a no-op. M01b and M05d are now killed. The spec note and the comment are in place.

**Next steps**: record F-A, F-B and F-C as open items. None blocks merge.

---

## Lessons signal

- **Survivor R2 / F-A -> candidate lesson: "Bound a timeout at both ends, and know the runtime's ceiling."** Fixing the 0 case of a timer setting is not enough. Node's `setTimeout` clamps values above 2^31-1 ms (and fractions) to 1 ms, so a "huge" value flips from no-timeout into an immediate timeout. Specify an upper bound and integer-ness, and pin `Infinity`, overflow and fraction cases in the parser's tests.
- **Confirmation of candidate "Test that a lock is released, not only that it excludes"** (from spec A): the new two-replica test killed M01b. Candidate can be promoted.
- **Confirmation of candidate "Revisit every parser when a field gains semantics"**: F2 was closed by one shared validator, and mutants C1-C5 prove each consumer is pinned independently.
- Note: `validate_state.py` and `lessons.py add` were not run, because they write into the real tree and this round is read-only. The orchestrator should run `lessons.py add` for the first item above.
