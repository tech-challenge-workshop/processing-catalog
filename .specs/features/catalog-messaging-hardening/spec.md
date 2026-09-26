# Catalog Messaging Hardening Specification — catalog

## Problem Statement

The Catalog is the system's only source of truth for request state, and four gaps remain in how it moves events.

- **The outbox relay (V5)** has two failure modes:
  - Two replicas would publish the same batch.
  - With the broker away, a publish can hang, and the relay stops trying.
- **The state machine (V7)** has two gaps:
  - It accepts `VideoRejected` for a `QUEUED` request and `ProcessingFailed` for a `RECEIVED` one.
  - It never compares `attemptId`, so an event from an old attempt can overturn the current one.
- **The retry backoff (V13)** treats a blank `RABBITMQ_RETRY_BACKOFF_MS` as 0 ms: the hot requeue loop AD-012 forbids.
- **The e2e suites** leave pending outbox rows in the stack's database, and the stack's relay publishes them.

Spec B also left two items: an oversized `sourceStorageKey` is a `500` on every retry (V38), and three test gaps (V39).

## Goals

- [ ] Every outbox row reaches the broker exactly once per successful publish, whatever the number of replicas, and a broker outage never stalls the relay
- [ ] Only the current attempt can move a request, and only along valid transitions
- [ ] No test run writes to the stack's database, and no malformed create reaches a `500`

## Out of Scope

| Feature | Reason |
| --- | --- |
| Notification's and Worker's items | Their own spec files in this feature |
| Changing the event contracts | `attemptId` is already carried by every attempt event |
| Exactly-once delivery | At-least-once plus consumer dedup stays the model (AD-010) |

---

## Assumptions & Open Questions

Decisions of 2026-09-26 are in `context.md` beside this spec.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Stale `attemptId` | No-op: the event is recorded as processed and the message is acked | Decided | y |
| `VideoRejected` outside `RECEIVED`; `ProcessingFailed` in `RECEIVED` | `ProcessingRequestDomainError` → rejected without requeue → DLQ | Decided | y |
| Test database | The e2e suites use `fiapx_e2e`, created and migrated by the suites' setup; `DATABASE_NAME` defaults to it under test | Decided | y |
| Publish timeout | `OUTBOX_PUBLISH_TIMEOUT_MS`, default 5000. A timed-out publish ends the drain and leaves the row pending | Long enough for a healthy confirm, short enough that the next 1 s tick retries promptly | y |
| Multiple replicas | Each row is published by one replica per successful publish. Per-request order is preserved as it is with one replica today | The mechanism is chosen in Design (context.md) | y |
| Blank or whitespace backoff | Treated as unset → 1000 ms | Mirrors the Worker's T19 behaviour | y |
| V38 bounds | `ownerUserId` at most 255 characters; `sourceStorageKey` at most 1024 (the S3 key limit). Longer → `400 <field> must be at most <n> characters` | Both columns are under a btree index; confirmed lesson L-005 | y |
| Validation order across fields | Field by field in the order `ownerUserId`, `sourceStorageKey`, `idempotencyKey`, each fully (required → string → blank → length) before the next | Pins what spec B's design implied (V39) | y |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: The relay publishes each row once and never stalls ⭐ MVP

**User Story**: As the operator, I want the outbox relay to be safe with several Catalog replicas and to keep retrying through a broker outage, so that no event is doubled or stuck.

**Why P1**: Scaling the Catalog today would double every event, and a broker blip can freeze the relay (V5).

**Acceptance Criteria**:

1. WHEN two relays drain the same outbox concurrently THEN each pending row SHALL be published exactly once.
2. WHILE two relays drain concurrently, the events of one request SHALL reach the broker in the order they were recorded.
3. IF the broker does not confirm a publish within `OUTBOX_PUBLISH_TIMEOUT_MS` THEN the drain SHALL stop, the row SHALL stay pending, and the next tick SHALL try again.
4. WHEN the broker comes back THEN every pending row SHALL be published and marked sent.

**Independent Test**: Against PostgreSQL, run two relays over 100 pending rows against a counting publisher: 100 publishes, each id once, per-request order kept. With a publisher that never confirms, the drain returns within the timeout and the row is still pending.

---

### P2: Only the current attempt, only valid transitions ⭐ MVP

**User Story**: As the system, I want an event from an old attempt ignored and invalid transitions refused, so that a request's state always reflects its current attempt.

**Why P2**: A late `ProcessingFailed` from an old attempt can fail a request whose current attempt succeeded (V7).

**Acceptance Criteria**:

1. IF `ProcessingStarted`, `ProcessingCompleted` or `ProcessingFailed` carries an `attemptId` different from the request's current one THEN the Catalog SHALL change nothing, publish nothing, record the event as processed, and ack it.
2. IF `ProcessingCompleted` carries no `attemptId` THEN the Catalog SHALL reject it without requeue.
3. IF `VideoRejected` arrives for a request that is not `RECEIVED` THEN the Catalog SHALL reject it without requeue, and the request SHALL keep its state.
4. IF `ProcessingFailed` arrives for a `RECEIVED` request THEN the Catalog SHALL reject it without requeue, and the request SHALL keep its state.
5. WHEN an event with the current `attemptId` arrives THEN the existing transitions SHALL behave as today, including AD-013's tolerated orderings.

**Independent Test**: A request `QUEUED` with attempt A2: `ProcessingFailed` for A1 leaves it `QUEUED` with the event recorded; `ProcessingFailed` for A2 fails it.

---

### P3: A blank backoff is not zero

**User Story**: As the operator, I want an empty `RABBITMQ_RETRY_BACKOFF_MS` to mean "default", so that a blank variable never starts a hot requeue loop.

**Why P3**: V13.

**Acceptance Criteria**:

1. WHEN `RABBITMQ_RETRY_BACKOFF_MS` is unset, empty or only whitespace THEN the backoff SHALL be 1000 ms.
2. WHEN it is `0` THEN the backoff SHALL be 0 ms.
3. IF it is negative or not a number THEN the backoff SHALL be 1000 ms.

**Independent Test**: `""`, `"  "` → 1000; `"0"` → 0; `"250"` → 250.

---

### P4: Tests never write to the stack's database

**User Story**: As a developer, I want the e2e suites to use their own database, so that running them next to the stack never publishes test events.

**Why P4**: Test rows reached the stack's DLQ during S4's validation.

**Acceptance Criteria**:

1. WHEN the e2e suites run with `DATABASE_HOST` set THEN they SHALL connect to `fiapx_e2e`, creating and migrating it when absent.
2. WHEN they finish THEN the `fiapx` database SHALL hold no row written by them.
3. IF `DATABASE_NAME` is set explicitly to `fiapx` for an e2e run THEN the suites SHALL refuse to start, naming the variable.

**Independent Test**: With the stack up, count `fiapx`'s outbox rows, run the e2e suites, count again: unchanged.

---

### P5: No malformed create reaches a 500, and spec B's gaps are tested

**User Story**: As a caller, I want every oversized field answered with a `400`, and the remaining create paths pinned by tests.

**Why P5**: V38 and V39.

**Acceptance Criteria**:

1. IF `ownerUserId` is longer than 255 characters THEN the Catalog SHALL respond `400 ownerUserId must be at most 255 characters` and write nothing.
2. IF `sourceStorageKey` is longer than 1024 characters THEN the Catalog SHALL respond `400 sourceStorageKey must be at most 1024 characters` and write nothing.
3. WHEN two fields are malformed THEN the message SHALL name the first field in the order `ownerUserId`, `sourceStorageKey`, `idempotencyKey`.
4. IF a lost race's re-read finds no winner THEN the Catalog SHALL surface the original error, not return an empty result.
5. WHEN tested against PostgreSQL THEN a key bound to another source SHALL give `409` even when the new source already has a request, and a pre-S6 `NULL`-key row SHALL be replayed with `200`.

**Independent Test**: A 1025-character source → `400`; a 1024-character one → `201`.

---

## Edge Cases

- WHEN a relay crashes after publishing and before marking THEN the row SHALL be published again (at-least-once, as today), and consumers SHALL deduplicate it.
- WHEN the stale-attempt event is redelivered THEN it SHALL still be a no-op.
- WHEN `ownerUserId` is exactly 255 characters THEN it SHALL be accepted.

---

## Requirement Traceability

`MSG-` is shared: this service owns `MSG-01` to `MSG-09`, `notification-service` `MSG-10` and `MSG-11`, `processing-worker` `MSG-12` to `MSG-15`.

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| MSG-01 | P1: One publication per row across replicas (V5) | Tasks | In Tasks |
| MSG-02 | P1: Publish timeout; relay keeps retrying (V5) | Execute | Implementing |
| MSG-03 | P2: Stale `attemptId` is a no-op (V7) | Tasks | In Tasks |
| MSG-04 | P2: `VideoRejected` only from `RECEIVED` (V7) | Tasks | In Tasks |
| MSG-05 | P2: `ProcessingFailed` never from `RECEIVED` (V7) | Tasks | In Tasks |
| MSG-06 | P3: Blank backoff is the default (V13) | Execute | Implementing |
| MSG-07 | P4: e2e suites use `fiapx_e2e` | Tasks | In Tasks |
| MSG-08 | P5: Field length bounds (V38) | Tasks | In Tasks |
| MSG-09 | P5: Spec B test gaps (V39) | Tasks | In Tasks |

**ID format:** `[CATEGORY]-[NUMBER]`

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 9 total, 9 mapped to tasks, 0 unmapped

---

## Success Criteria

- [ ] Two relays never double-publish, and a hung broker never stalls the relay
- [ ] An old attempt cannot move a request
- [ ] The stack's outbox is untouched by a test run

---

## Dependencies

None to build. `processing-worker` already sends `attemptId` on every attempt event.
