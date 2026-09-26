# Catalog Messaging Hardening Tasks — catalog

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.** (In this project's sessions the skill is not registered by name; the user has authorized reading it from `.agents/skills/tlc-spec-driven/` by path.)

---

**Design**: `.specs/features/catalog-messaging-hardening/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec — confirm before Execute. Guidelines found: none, so strong defaults apply. Same layers as `api-hardening/tasks.md` (spec B).
>
> Lessons applied:
> - **L-005** (confirmed): bound client tokens stored under an index.
> - **Candidates:**
>   - L-006: pin cross-field order with a two-field test.
>   - L-007: test the re-read that finds nothing.
>   - L-010: doubles raise what the real adapter raises.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Config parsing (backoff, timeout) | unit | Unset, empty, whitespace, `0`, negative, non-numeric, and a valid value | `src/infrastructure/**/*.spec.ts` | `npm test` |
| Outbox relay | integration | Two relays racing, per-request order, stop-and-commit on a timeout, and recovery, all against PostgreSQL | `test/*.e2e-spec.ts` (DB-guarded) | `DATABASE_HOST=localhost npm run test:e2e` |
| Domain | unit | Every status × every transition in scope, valid and invalid | `src/domain/*.spec.ts` | `npm test` |
| Use cases | unit + integration | Stale attempt for each of Started, Completed and Failed; the current attempt unchanged, including AD-013's no-ops; nothing written on a stale event except the processed record | `src/application/*.spec.ts`, `test/*.e2e-spec.ts` | both |
| Consumers | unit | Missing `attemptId` on Completed → nack without requeue; origin passed for Rejected and Failed | `src/infrastructure/rabbitmq/*.spec.ts` | `npm test` |
| Controller + route | e2e | Every new 400 with its exact message; the boundary values accepted; nothing written | `test/*.e2e-spec.ts` | `npm run test:e2e` |
| e2e harness | integration | Defaults to `fiapx_e2e`, refuses `fiapx`, creates the database when absent, leaves the stack's `fiapx` outbox untouched | `test/support/*` | `DATABASE_HOST=localhost npm run test:e2e` |

## Gate Check Commands

> Generated from codebase — confirm before Execute. Port 5432 is taken on this machine: run PostgreSQL elsewhere with the platform's `db/init` mounted, and set `DATABASE_PORT`. After T8, the suites use `fiapx_e2e` automatically. Before T8, use a fresh container.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Unit-only tasks | `npm test` |
| Full | Tasks with e2e or integration tests | `npm test && DATABASE_HOST=localhost npm run test:e2e` |
| Build | Last task of a phase | `npm run lint && npm run typecheck && npm test && DATABASE_HOST=localhost npm run test:e2e && npm run build` |

---

## Execution Plan

### Phase 1: The relay

```
T1
T2 -> T3
```

### Phase 2: Attempts and transitions

```
T4 -> T5
T6 -> T7
```

### Phase 3: Tests and bounds

```
T8
T9 -> T10
```

---

## Task Breakdown

### Phase 1: The relay

### T1: A blank backoff is the default

**What**: `retryBackoffMs()` treats unset, empty and whitespace-only values as 1000. `0` stays 0, and negative or non-numeric values become 1000.
**Where**: `src/infrastructure/rabbitmq/settle-failed-message.ts`
**Depends on**: None
**Reuses**: Its existing spec
**Requirement**: MSG-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Each of these inputs gives the expected value: `""` 1000, `"  "` 1000, unset 1000, `"0"` 0, `"250"` 250, `"-1"` 1000, `"abc"` 1000
- [x] Removing the blank check turns the `""` case red
- [x] Quick gate passes

**Tests**: unit
**Gate**: quick

**Status**: ✅ Complete. `parseNonNegativeMs(raw, fallback)` holds the rule (T2 reuses it). Seen red first: `""` and `"  "` failed before the fix; removing the blank check again turned both red. Quick gate 186 passed (179 + 7), 0 skipped.

---

### T2: Publish with a timeout

**What**: `sendToQueue` passes `{ timeout: outboxPublishTimeoutMs() }` to the channel wrapper. `outboxPublishTimeoutMs()` reads `OUTBOX_PUBLISH_TIMEOUT_MS`: 5000 by default, with the same blank rule as T1.
**Where**: `src/infrastructure/rabbitmq/rabbitmq.connection.ts`
**Depends on**: None
**Reuses**: `amqp-connection-manager`'s `timeout` option
**Requirement**: MSG-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Unit: a fake wrapper receives `timeout` 5000 by default, and the configured value when one is set
- [x] Parser cases as in T1
- [x] Quick gate passes

**Tests**: unit
**Gate**: quick

**Status**: ✅ Complete. New `rabbitmq.connection.spec.ts` (9 tests), seen red before the change; dropping the option turns both wrapper tests red. `"0"` maps to 0 as in T1, which `amqp-connection-manager` reads as "no timeout" (documented beside the parser). Also carries a prettier-only reformat of T1's `parseNonNegativeMs`. Quick gate 195 passed, 0 skipped.

---

### T3: One drainer at a time; stop and commit on failure

**What**: `drain` runs in a transaction behind `pg_try_advisory_xact_lock`, and returns 0 when it cannot take the lock. On the first publish failure it stops, commits the marks made so far, and then rethrows.
**Where**: `src/infrastructure/messaging/outbox-relay.ts`
**Depends on**: T2
**Reuses**: The existing relay e2e and its PostgreSQL harness
**Requirement**: MSG-01, MSG-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] PostgreSQL: two relays on two data sources drain 100 rows for 10 requests. The counting publisher sees each id exactly once, and each request's events arrive in id order
- [x] PostgreSQL: a publisher that rejects on row 3 leaves rows 1–2 marked sent and rows 3 onwards pending. A second drain publishes the rest
- [x] A publisher that never resolves, run with a short `OUTBOX_PUBLISH_TIMEOUT_MS` through the real connection wrapper (or an injected equivalent), returns within the timeout and leaves the row pending
- [~] Removing the lock makes the two-relay test count duplicates. Marking outside the transaction breaks the stop-and-commit test
- [x] Build gate passes

**Tests**: integration
**Gate**: build

**Status**: ✅ Complete, with one open item. Four new tests in `test/outbox-relay.e2e-spec.ts` (two relays, lock held elsewhere → 0, stop-and-commit, never-confirming broker through the real `RabbitMQConnection` pointed at `amqp://127.0.0.1:1` with a 300 ms timeout). Seen red before the change: the two-relay test (200 publishes) and the lock test. The stop-and-commit and timeout tests were already green, because the old autocommit drain stopped at the first failure and T2 added the timeout. Negatives: no lock → 200 publishes plus the lock test red; the error escaping the transaction (rolling back rows 1–2) → stop-and-commit red; no publish timeout → the timeout test hangs past 10 s. **Open**: the literal mutant "UPDATE through `this.dataSource` instead of the transaction's manager" survives. Those marks autocommit, so every spec outcome is identical; no behavior test can tell it apart. Build gate: lint, typecheck, 195 unit, 152 e2e (148 + 4), build; 0 skipped.

---

### Phase 2: Attempts and transitions

### T4: Reject only from RECEIVED

**What**: Add a domain function `rejectProcessingRequest(request, code)` that is allowed only from `RECEIVED` and raises `ProcessingRequestDomainError` otherwise. `failProcessingRequest` is left unchanged here; T5 narrows it together with its caller, so no gate is red in between.
**Where**: `src/domain/processing-request.ts`
**Depends on**: None (Phase 1 complete)
**Reuses**: `FAILABLE_STATUSES`
**Requirement**: MSG-04, MSG-05

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Unit: every status × `rejectProcessingRequest`, checking both the accepted and the refused cases
- [x] No existing test changes
- [x] Quick gate passes (unit, domain)

**Tests**: unit
**Gate**: quick

**Status**: ✅ Complete. Six new tests in `src/domain/processing-request.spec.ts`: RECEIVED is rejected (FAILED, code stored, no attempt), QUEUED/PROCESSING/COMPLETED/FAILED are refused with `Cannot reject request in <status> status` and left unchanged, and a code outside the vocabulary is refused. Seen red first (function absent). Negative: dropping the RECEIVED guard turns the four refusal cases red. No existing test changed. Quick gate 201 passed (195 + 6), 0 skipped.

---

### T5: Rejections and processing failures take their own path

**What**: `failProcessingRequest` becomes allowed only from `QUEUED` and `PROCESSING` (unit: every status). `FailProcessingRequestInput` gains `origin: 'validation' | 'processing'` and an optional `attemptId`. The use case calls `rejectProcessingRequest` or `failProcessingRequest` depending on `origin`. `video-rejected.consumer.ts` passes `validation`; `processing-failed.consumer.ts` passes `processing` together with the `attemptId`.
**Where**: `src/application/fail-processing-request.use-case.ts` (+ the two consumers)
**Depends on**: T4
**Reuses**: The lifecycle e2e
**Requirement**: MSG-04, MSG-05

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `VideoRejected` for a `QUEUED` request is nacked without requeue, and the request stays `QUEUED`. The same holds for `PROCESSING`
- [x] `ProcessingFailed` for a `RECEIVED` request is nacked without requeue, and the request stays `RECEIVED`
- [x] The valid paths are unchanged: rejection from `RECEIVED`, and failure from `QUEUED` or `PROCESSING`
- [x] Existing tests that failed a `RECEIVED` request through `failProcessingRequest` are listed and moved to the rejection path, with no assertion weakened
- [x] Full gate passes

**Tests**: unit + integration
**Gate**: full

**Status**: ✅ Complete. `FAILABLE_STATUSES` is now QUEUED and PROCESSING; the use case picks `rejectProcessingRequest` for `origin: 'validation'` and `failProcessingRequest` for `'processing'`. New tests (seen red first): domain, `failProcessingRequest` refuses RECEIVED; use case, a validation rejection for QUEUED/PROCESSING and a processing failure for RECEIVED change nothing (state, code, outbox, processed record), and QUEUED fails on `processing`; consumers, the origin (and `attemptId`) handed to the use case, and the nack without requeue driven through the real channel callback for each invalid case, plus the ack for a valid rejection; PostgreSQL (`test/lifecycle-ordering.e2e-spec.ts`), both invalid transitions leave the row, the outbox and the processed record untouched. **Moved tests** (assertions unchanged): `processing-request.spec.ts` "fails a RECEIVED request and records the code" now calls `rejectProcessingRequest`; in `fail-processing-request.use-case.spec.ts` the seven tests on a RECEIVED request pass `origin: 'validation'` (the "already terminal" test's second call passes `origin: 'processing'`, which keeps its `Cannot fail request in FAILED status` message), and the two PROCESSING tests pass `origin: 'processing'` with the attempt. Negatives: the use case ignoring the origin → 14 red; VideoRejected passing `processing` → 6 red; ProcessingFailed passing `validation` → 5 red; RECEIVED back in `FAILABLE_STATUSES` → 3 red. Full gate: 213 unit (201 + 12), 154 e2e (152 + 2), 0 skipped.

---

### T6: ProcessingCompleted must carry its attemptId

**What**: `processing-completed.consumer.ts` requires and parses `attemptId`, and passes it to the use case. A message without it is a domain error, so it is nacked without requeue.
**Where**: `src/infrastructure/rabbitmq/processing-completed.consumer.ts`
**Depends on**: None (Phase 1 complete)
**Reuses**: The Started and Failed consumers' parsing
**Requirement**: MSG-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] A message without `attemptId` is nacked without requeue, and the use case is not called
- [x] Near-miss: an empty `attemptId` is treated the same way
- [x] Quick gate passes

**Tests**: unit
**Gate**: quick

**Status**: ✅ Complete. The consumer requires a non-blank string `attemptId` and hands it to the use case (`CompleteProcessingRequestInput.attemptId` is optional until T7 compares it). Five new tests in `processing-completed.consumer.spec.ts` (seen red first): the `attemptId` handed over, and missing, empty, whitespace-only and `null` values each dead-lettered through the real channel callback (nack without requeue, no ack) with the use case not called and the request still PROCESSING. The five existing payloads now carry the request's `attemptId`; no assertion changed. Negatives: no check → 4 red; a presence-only check → 3 red; `attemptId` not passed → 1 red. Quick gate 218 passed (213 + 5), 0 skipped. The quick gate does not run `test/local-docker-integration.e2e-spec.ts`, whose four `processing.completed` deliveries carried no `attemptId`: the happy path went red and the replay test passed only because its completion was dead-lettered. They now carry the queued attempt (a random one for the RECEIVED case); e2e 154 passed, 0 skipped.

---

### T7: An old attempt changes nothing

**What**: The Start, Complete and processing-Fail use cases compare `input.attemptId` with `request.attemptId` right after `findForUpdate`, before AD-013's no-ops. When they differ, the use case calls `markEventProcessed`, returns the request unchanged, and writes no outbox entry.
**Where**: `src/application/start-processing-request.use-case.ts` (+ the complete and fail use cases)
**Depends on**: T6
**Reuses**: The lifecycle-ordering suite
**Requirement**: MSG-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Unit, for each of Started, Completed and Failed: a stale attempt leaves the request unchanged, adds no outbox entry, and records the event as processed. A redelivery of it is also a no-op
- [ ] A stale Completed that restates the stored key is still a no-op, not an AD-013 restatement (the check order)
- [ ] PostgreSQL: a `QUEUED` request on attempt A2 receives `ProcessingFailed` for A1 and stays `QUEUED`. `ProcessingFailed` for A2 then fails it
- [ ] Removing the comparison from any one of the three use cases turns its test red
- [ ] Build gate passes

**Tests**: unit + integration
**Gate**: build

---

### Phase 3: Tests and bounds

### T8: The e2e suites use their own database

**What**:
- Add `test/support/e2e-database.setup.ts` as a `setupFiles` entry. It defaults `DATABASE_NAME` to `fiapx_e2e` and refuses `fiapx`.
- Add `test/support/e2e-database.global-setup.ts` as `globalSetup`. It creates the `fiapx_e2e` database and its `catalog` schema as the admin user (`DATABASE_ADMIN_USER`/`DATABASE_ADMIN_PASSWORD`, default `postgres`/`postgres`).
- List every suite that names `fiapx`, and fix it.

**Where**: `test/jest-e2e.json` (+ the two support files)
**Depends on**: None (Phase 2 complete)
**Reuses**: The existing DB-guarded suites
**Requirement**: MSG-07

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] On an empty server, the e2e run creates `fiapx_e2e` and passes with 0 skipped
- [ ] With the platform stack up: the number of rows in `fiapx`'s `catalog.outbox` before and after a full e2e run is equal
- [ ] `DATABASE_NAME=fiapx npm run test:e2e` fails before any suite runs, naming the variable
- [ ] CI still passes (the workflow needs no change; confirm the service's admin credentials)
- [ ] Full gate passes

**Tests**: integration
**Gate**: full

---

### T9: Bound the create's fields

**What**: `validateDto` bounds `ownerUserId` to at most 255 characters and `sourceStorageKey` to at most 1024. Each check runs after that field's blank check, and the fields are checked in order.
**Where**: `src/interface/create-processing-request.controller.ts`
**Depends on**: None (Phase 2 complete)
**Reuses**: `test/create-processing-request-route.e2e-spec.ts`
**Requirement**: MSG-08

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] 256 and 255 characters of `ownerUserId` give the exact `400` and `201` respectively. 1025 and 1024 characters of `sourceStorageKey` do the same
- [ ] Nothing is written on any of these `400`s
- [ ] A 3000-character source (V38's case) gives `400`, not `500`
- [ ] Full gate passes

**Tests**: e2e
**Gate**: full

---

### T10: Close spec B's test gaps

**What**: Add the tests V39 lists:
- the order across fields;
- the lost-race re-read finding nothing, for both the key branch and the source branch;
- against PostgreSQL, a `409` when the new source already has a request, and replay of a `NULL`-key row.

**Where**: `test/create-processing-request-route.e2e-spec.ts` (+ `src/application/create-processing-request.use-case.spec.ts`)
**Depends on**: T9
**Reuses**: Spec B's suites
**Requirement**: MSG-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Each new test fails under its mutant:
  - M13: key length checked before the other fields' type;
  - M14: the re-read miss returns `undefined`;
  - source checked before key for the `409`;
  - `NULL`-key rows ignored
- [ ] Build gate passes

**Tests**: unit + e2e
**Gate**: build

---

## Phase Execution Map

```
Phase 1 (T1 T2 T3) then Phase 2 (T4 T5 T6 T7) then Phase 3 (T8 T9 T10)
```

10 tasks. Cross-repository: this repository, then `notification-service` (2 tasks), then `processing-worker` (4 tasks).

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1 | 1 function | ✅ Granular |
| T2 | 1 method + 1 parser | ✅ Granular |
| T3 | 1 method | ✅ Granular |
| T4 | 2 domain functions | ✅ Granular |
| T5 | 1 domain narrowing + 1 use case + 2 call sites | ⚠️ OK - cohesive; the narrowing must land with its callers |
| T6 | 1 consumer | ✅ Granular |
| T7 | 1 check in 3 use cases | ⚠️ OK - cohesive; one rule applied to every attempt event |
| T8 | Jest config + 2 support files | ⚠️ OK - cohesive; one harness change |
| T9 | 1 function | ✅ Granular |
| T10 | Tests only (1 unit + 1 e2e file) | ⚠️ OK - cohesive; one requirement's test gaps |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows (within phase) | Status |
| --- | --- | --- | --- |
| T1 | None | — | ✅ Match |
| T2 | None | — | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | None (Phase 1 complete) | — | ✅ Match |
| T5 | T4 | T4 → T5 | ✅ Match |
| T6 | None (Phase 1 complete) | — | ✅ Match |
| T7 | T6 | T6 → T7 | ✅ Match |
| T8 | None (Phase 2 complete) | — | ✅ Match |
| T9 | None (Phase 2 complete) | — | ✅ Match |
| T10 | T9 | T9 → T10 | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Config parsing | unit | unit | ✅ OK |
| T2 | Config parsing + connection | unit | unit | ✅ OK |
| T3 | Outbox relay | integration | integration | ✅ OK |
| T4 | Domain | unit | unit | ✅ OK |
| T5 | Use case + consumers | unit + integration | unit + integration | ✅ OK |
| T6 | Consumer | unit | unit | ✅ OK |
| T7 | Use cases | unit + integration | unit + integration | ✅ OK |
| T8 | e2e harness | integration | integration | ✅ OK |
| T9 | Controller + route | e2e | e2e | ✅ OK |
| T10 | Use case + route (tests) | unit + e2e | unit + e2e | ✅ OK |
