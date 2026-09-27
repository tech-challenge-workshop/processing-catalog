# Service Robustness Specification — catalog

## Problem Statement

The spec A Verifier left three items in the Catalog.

- **V45: `OUTBOX_PUBLISH_TIMEOUT_MS="0"` freezes the relay.** The value is parsed as 0, and `amqp-connection-manager` reads 0 as "no timeout". With a silent broker the publish never settles, and the scheduler's `draining` flag then blocks every later tick until the service restarts. That is exactly the stall V5 removed.
- **V46: a malformed `attemptId` on `ProcessingStarted` or `ProcessingFailed` is acked silently.** Those consumers only check that the field is present, so `null` becomes the string `"null"`. That string counts as a stale attempt, the message is acked with no DLQ signal, and the request can stay in `PROCESSING` forever.
- **V47:**
  - No test proves that the relay's advisory lock is released after a drain.
  - The order "dedup under the lock, then the stale check" in the Fail use case is not pinned.
  - The `RECEIVED` exemption from stale checks is not written in the spec.
  - A doc comment is orphaned.

## Goals

- [ ] No configuration value can disable the relay's publish timeout
- [ ] Every attempt event with a malformed `attemptId` reaches the DLQ
- [ ] The relay lock and the Fail check order are pinned by tests

## Out of Scope

| Feature | Reason |
| --- | --- |
| Notification and Worker items | Their own spec files in this feature |
| Changing the event contracts | `attemptId` is already a string in every attempt event the Worker sends |

---

## Assumptions & Open Questions

Decisions of 2026-09-26 are in `context.md` beside this spec.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| `OUTBOX_PUBLISH_TIMEOUT_MS` of `0` or less | Treated like an invalid value → 5000 | In this library 0 means "never time out", which is the failure V5 removed. The backoff keeps `0` = no pause, because 0 is meaningful for a pause | y |
| What counts as a valid `attemptId` | A non-blank string | Same rule `ProcessingCompleted`'s `hasAttemptId` already applies | y |
| A malformed `attemptId` | `ProcessingRequestDomainError` → rejected without requeue → DLQ | AD-012: a message that is wrong is dead-lettered | y |
| The `RECEIVED` exemption | Written as MSG-03's clarification in `catalog-messaging-hardening/spec.md`: a request that has no attempt yet is never stale | The spec A Verifier found it is the only reading that satisfies both MSG-03 and MSG-05 | y |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: The publish timeout cannot be disabled ⭐ MVP

**User Story**: As the operator, I want the relay's publish timeout to always be a real timeout, so that a broker outage never freezes the relay.

**Why P1**: V45 reopens V5 with a single configuration value.

**Acceptance Criteria**:

1. WHEN `OUTBOX_PUBLISH_TIMEOUT_MS` is `0` or negative THEN the timeout SHALL be 5000 ms.
2. WHEN it is unset, blank or not a number THEN the timeout SHALL be 5000 ms, as today.
3. WHEN it is a positive integer THEN the timeout SHALL be that value.
4. WHILE the broker is silent and the timeout is configured as `0`, each drain SHALL return within 5000 ms and leave the row pending.

**Independent Test**: `outboxPublishTimeoutMs()` with `"0"` returns 5000. A relay e2e with `OUTBOX_PUBLISH_TIMEOUT_MS=0` and an unreachable broker returns and leaves the row pending.

---

### P2: A malformed `attemptId` goes to the DLQ ⭐ MVP

**User Story**: As the operator, I want an attempt event whose `attemptId` is not a real id rejected to the DLQ, so that a Worker bug is visible instead of silently acked.

**Why P2**: V46 hides the failure, and the request stays stuck.

**Acceptance Criteria**:

1. IF `ProcessingStarted` or `ProcessingFailed` carries an `attemptId` that is missing, `null`, not a string, empty or blank THEN the Catalog SHALL reject it without requeue and SHALL NOT call the use case.
2. The three attempt consumers (Started, Completed, Failed) SHALL apply the same `attemptId` rule.
3. WHEN the `attemptId` is a valid string that differs from the request's current one THEN the event SHALL still be a stale no-op (MSG-03, unchanged).

**Independent Test**: `ProcessingFailed` with `attemptId: null` is nacked with `requeue=false`, and the request keeps its state.

---

### P3: The relay lock and the Fail check order are pinned

**User Story**: As a maintainer, I want the remaining spec A behaviours pinned by tests, so that a regression turns the gate red.

**Why P3**: V47 (surviving mutants M01b and M05d).

**Acceptance Criteria**:

1. WHEN relay A finishes a drain THEN relay B SHALL be able to take the lock and drain rows inserted afterwards.
2. WHEN a redelivered stale `ProcessingFailed` arrives concurrently with its first delivery THEN exactly one processed-event record SHALL exist, and the request SHALL keep its state.
3. The spec SHALL state MSG-03's `RECEIVED` exemption.
4. The orphaned doc comment in `src/domain/processing-request.ts` SHALL sit above the function it documents.

**Independent Test**: With a session-level lock that is never released, relay B's drain after relay A's fails the test.

---

## Edge Cases

- WHEN `OUTBOX_PUBLISH_TIMEOUT_MS` is `"  "` THEN the timeout SHALL be 5000 ms.
- WHEN `attemptId` is the number `1` THEN it SHALL be rejected, not converted to `"1"`.

---

## Requirement Traceability

`ROB-` is shared: this service owns `ROB-01` to `ROB-03`, `notification-service` `ROB-04` and `ROB-05`, and `processing-worker` `ROB-06` to `ROB-09`.

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| ROB-01 | P1: Timeout cannot be disabled (V45) | Tasks | In Tasks |
| ROB-02 | P2: Malformed `attemptId` to the DLQ (V46) | Tasks | In Tasks |
| ROB-03 | P3: Lock release, Fail order, spec note, comment (V47) | Tasks | In Tasks |

**ID format:** `[CATEGORY]-[NUMBER]`

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 3 total, 3 mapped to tasks, 0 unmapped

---

## Success Criteria

- [ ] No value of `OUTBOX_PUBLISH_TIMEOUT_MS` lets a publish wait forever
- [ ] `attemptId: null` reaches the DLQ for every attempt event

---

## Dependencies

None.
