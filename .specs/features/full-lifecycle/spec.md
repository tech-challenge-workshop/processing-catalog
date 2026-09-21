# Catalog Full Lifecycle Specification

## Problem Statement

The Catalog owns the `ProcessingRequest` lifecycle, but only three of its five states are reachable. `PROCESSING` and `FAILED` exist as enum values in `src/domain/processing-request.ts:6` with no transition function, no consumer, and no event. A video that cannot be processed has nowhere to go, so the challenge's error-notification requirement has no path through the system.

The terminal contract blocks it structurally: `TerminalEventDto` declares `zipStorageKey: string` as required and carries no failure field, so the Catalog cannot express a failed outcome even if it could reach one.

## Goals

- [ ] Make every state in the approved state machine reachable and guarded.
- [ ] Let a terminal event carry either a stored package or a safe failure reason.
- [ ] Keep every transition idempotent under redelivery.

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
| --- | --- |
| PostgreSQL persistence and the transactional outbox | Owned by S3, which must build on the aggregate shape this slice settles. |
| Sending email | Owned by S7. This slice publishes the event; delivery is the Notification Service's concern. |
| FFprobe, FFmpeg, ZIP creation and object storage | Owned by S4 in the Worker. |
| Automatic business retry or user-initiated reprocessing | The foundation fixes one business attempt per request. |
| Owner-scoped status queries | Owned by S5. |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here - nothing is left silently unclear.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Failure code vocabulary | `FORMATO_INVALIDO`, `DURACAO_EXCEDIDA`, `PROCESSAMENTO_FALHOU` | Fixed by `docs/foudation.md`; inventing codes here would fork the contract. | y |
| Who maps code to user-facing reason | The Catalog | It owns the aggregate and is the only service that publishes terminal events, so the safe text has one origin. | y |
| Persistence in this slice | The existing in-memory repository | S3 replaces it. Settling the aggregate shape first avoids migrating a schema that is about to change. | y |
| Shape of the terminal contract | One event type where `zipStorageKey` and `failureReason` are both optional | The Notification Service already declares exactly this shape, so the Catalog is the side that is out of step. | y |
| `PROCESSING` as a precondition for completion | `COMPLETED` is reachable from `PROCESSING` only | With `ProcessingStarted` introduced, a completion that never started indicates a lost event rather than a valid path. | y |
| Redelivery of a terminal event | Deduplicated by `eventId`, as today | The existing consumers already do this; the new ones must not weaken it. | y |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Own every state in the lifecycle ⭐ MVP

**User Story**: As the system, I want the Catalog to accept the full vocabulary of processing outcomes so that a request reaches a correct terminal state whether it succeeds or fails.

**Why P1**: `FAILED` being unreachable is what blocks the error-notification requirement end to end.

**Acceptance Criteria** (each line is one EARS pattern):

1. WHEN the Catalog consumes `ProcessingStarted` for a `QUEUED` request THEN it SHALL transition that request to `PROCESSING` and SHALL publish no terminal event. <!-- event-driven -->
2. WHEN the Catalog consumes `ProcessingCompleted` for a `PROCESSING` request THEN it SHALL transition that request to `COMPLETED` and record the `zipStorageKey`. <!-- event-driven -->
3. WHEN the Catalog consumes `VideoRejected` for a `RECEIVED` request THEN it SHALL transition that request to `FAILED` and record the reported `failureCode`. <!-- event-driven -->
4. WHEN the Catalog consumes `ProcessingFailed` for a `QUEUED` or `PROCESSING` request THEN it SHALL transition that request to `FAILED` and record the reported `failureCode`. <!-- event-driven -->
5. WHILE a request is in a terminal state, the Catalog SHALL reject every further transition and SHALL leave the stored state unchanged. <!-- state-driven -->
6. IF an event requests a transition the state machine does not permit THEN the Catalog SHALL reject it, retain the prior state, and publish no event. <!-- unwanted-behavior -->
7. IF the same `eventId` is consumed again THEN the Catalog SHALL apply no second transition and publish no second event. <!-- event-driven -->
8. IF an event carries an unrecognised `failureCode` THEN the Catalog SHALL reject it rather than store an unknown code. <!-- unwanted-behavior -->

**Independent Test**: Drive one request to `COMPLETED` through `ProcessingStarted` then `ProcessingCompleted`, and a second to `FAILED` through `VideoRejected`; replay every event and assert no state or publication changed.

---

### P2: Publish a terminal event that can carry a failure

**User Story**: As the Notification Service, I want one terminal event shape that describes success or failure so that I can notify the owner of either outcome without guessing.

**Why P2**: The Catalog can reach `FAILED` without this, but nothing downstream would learn why.

**Acceptance Criteria**:

1. WHEN a request reaches `COMPLETED` THEN the Catalog SHALL publish exactly one terminal event carrying `status` `COMPLETED` and the `zipStorageKey`. <!-- event-driven -->
2. WHEN a request reaches `FAILED` THEN the Catalog SHALL publish exactly one terminal event carrying `status` `FAILED` and a `failureReason`. <!-- event-driven -->
3. The terminal event SHALL declare `zipStorageKey` and `failureReason` as optional, and SHALL carry exactly one of them. <!-- ubiquitous -->
4. WHEN the Catalog derives a `failureReason` THEN it SHALL map from the recorded `failureCode` through a single defined mapping. <!-- event-driven -->
5. The published `failureReason` SHALL NOT contain a stack trace, an exception message, a storage key, or any internal identifier beyond `processingRequestId`. <!-- ubiquitous -->
6. IF publishing a terminal event fails THEN the Catalog SHALL surface the failure and SHALL NOT acknowledge the source message as successful. <!-- unwanted-behavior -->

**Independent Test**: Assert the published payload for one completed and one failed request, field by field, including the absence of the field that does not apply.

---

## Edge Cases

- IF `ProcessingCompleted` arrives for a request still in `QUEUED` THEN the Catalog SHALL reject it, because a completion without a start indicates a lost `ProcessingStarted`.
- IF `ProcessingStarted` arrives twice with different `eventId` values for the same request THEN the second SHALL be rejected as an unpermitted `PROCESSING` to `PROCESSING` transition.
- IF `VideoRejected` arrives for a request that is already `QUEUED` THEN the Catalog SHALL reject it, because acceptance and rejection are mutually exclusive outcomes of one validation.
- IF an event names a `processingRequestId` that does not exist THEN the Catalog SHALL reject it and SHALL NOT create a request.
- WHEN a terminal event is published for a request that failed before any attempt started THEN it SHALL carry no `attemptId`.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| LC-01 | P1: Own every state | Design | Pending |
| LC-02 | P1: Own every state | Design | Pending |
| LC-03 | P1: Own every state | Design | Pending |
| LC-04 | P1: Own every state | Design | Pending |
| LC-05 | P1: Own every state | Design | Pending |
| LC-06 | P1: Own every state | Design | Pending |
| LC-07 | P1: Own every state | Design | Pending |
| LC-08 | P1: Own every state | Design | Pending |
| LC-09 | P2: Terminal event | Design | Pending |
| LC-10 | P2: Terminal event | Design | Pending |
| LC-11 | P2: Terminal event | Design | Pending |
| LC-12 | P2: Terminal event | Design | Pending |
| LC-13 | P2: Terminal event | Design | Pending |
| LC-14 | P2: Terminal event | Design | Pending |

**ID format:** `LC-[NUMBER]`

**Coverage:** 14 total, 0 mapped to tasks, 14 unmapped (mapping happens in Tasks).

---

## Success Criteria

- [ ] A request reaches `FAILED` from rejection and from processing failure, each publishing exactly one terminal event.
- [ ] A request reaches `COMPLETED` only after passing through `PROCESSING`.
- [ ] Replaying every event in the suite changes no state and publishes nothing further.
- [ ] No published failure text exposes an internal detail.
