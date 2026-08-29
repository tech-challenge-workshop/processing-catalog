# Catalog Local Docker Integration Specification

## Problem Statement

Catalog owns request lifecycle but currently has no real RabbitMQ topology or terminal lifecycle path. It must own local event transitions and a local-only request observation endpoint.

## Goals

- [x] Publish and consume documented local JSON events through RabbitMQ.
- [x] Own `RECEIVED → QUEUED → COMPLETED` and reject invalid transitions.
- [x] Expose request state only in the local integration profile.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Docker Compose file, API HTTP edge, Worker media work, Notification delivery | Owned elsewhere. |
| Database/outbox/AWS/shared contracts | Intentionally deferred. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- |
| Local state | in-memory repository survives only a Compose run | persistence is out of scope | y |
| Observation route | route exists only when `LOCAL_INTEGRATION=true` | smoke test needs evidence without production exposure | y |

**Open questions:** none.

## User Stories

### P1: Own the local processing lifecycle ⭐ MVP

**Acceptance Criteria**:

1. WHEN Catalog creates a request, THEN it SHALL publish one `VideoValidationRequested` JSON message with `eventId`, `processingRequestId`, `ownerUserId`, `sourceStorageKey`, and `occurredAt`. <!-- event-driven -->
2. WHEN Catalog receives valid `VideoAccepted`, THEN it SHALL transition the matching request from `RECEIVED` to `QUEUED` and publish `ProcessingQueued` with owner, source key, attempt ID, and occurred time. <!-- event-driven -->
3. WHEN Catalog receives valid `ProcessingCompleted`, THEN it SHALL transition the matching request from `QUEUED` to `COMPLETED` and publish one terminal event with owner, `COMPLETED`, ZIP key, and occurred time. <!-- event-driven -->
4. WHEN the same event ID is received again, THEN Catalog SHALL create no second transition or follow-up event. <!-- event-driven -->
5. IF an event lacks `processingRequestId` or requests an unsupported transition, THEN Catalog SHALL reject it, retain the prior state, and publish no success event. <!-- unwanted-behavior -->
6. IF required follow-up publication fails, THEN Catalog SHALL surface the failure and SHALL not acknowledge the source message as successful. <!-- unwanted-behavior -->
7. WHEN `LOCAL_INTEGRATION=true`, THEN Catalog SHALL expose a read-only request-state endpoint; IF the flag is absent, THEN it SHALL not expose that endpoint. <!-- event-driven -->

**Independent Test**: Send acceptance/completion/duplicate/invalid events through the local queue and assert state plus published payloads.

### P2: Close Catalog quality gaps

1. WHEN lint runs, THEN Catalog SHALL finish with zero warnings. <!-- event-driven -->
2. WHEN an unsupported transition is attempted, THEN a direct aggregate test SHALL assert the prior state remains unchanged. <!-- event-driven -->
3. The Catalog SHALL retain AppleDouble exclusions without runtime change. <!-- ubiquitous -->

## Edge Cases

- IF RabbitMQ is unavailable, THEN Catalog readiness SHALL be false.

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| CAT-01 | P1 | Design | Verified |
| CAT-02 | P1 | Design | Verified |
| CAT-03 | P1 | Design | Verified |
| CAT-04 | P1 | Design | Verified |
| CAT-05 | P1 | Design | Verified |
| CAT-06 | P1 | Design | Verified |
| CAT-07 | P1 | Design | Verified |
| CAT-08 | P2 | Design | Verified |
| CAT-09 | P2 | Design | Verified |
| CAT-10 | P2 | Design | Verified |

## Success Criteria

- [x] Catalog reaches `COMPLETED` through local RabbitMQ and publishes one terminal event.
- [x] All Catalog gates pass without lint warnings.
