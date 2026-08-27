# Catalog Initial Vertical Slice Specification

## Problem Statement

The Catalog is the durable owner of `ProcessingRequest`. Its first slice must create a request in `RECEIVED` state and publish the documented validation request, proving the beginning of the asynchronous lifecycle.

## Goals

- [ ] Define controlled request creation and the `RECEIVED` state.
- [ ] Define publication and duplicate handling for `VideoValidationRequested`.

## Out of Scope

| Feature | Reason |
| --- | --- |
| PostgreSQL, migrations, and transactional outbox implementation | Added after the controlled slice proves lifecycle behavior. |
| Worker media validation or processing | Owned by Processing Worker. |
| HTTP authentication and upload transfer | Owned by FIAP X API. |

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Persistence in this slice | Controlled in-memory persistence is allowed. | The slice proves domain behavior before AWS/RDS wiring. | Yes |
| Event payload | Stable JSON from `docs/foudation.md`. | The MVP has no shared contracts package or event version mechanism. | Yes |

**Open questions:** none - all resolved or logged above.

## User Stories

### P1: Create and publish validation request

**User Story**: As a developer, I want the Catalog to create one request and publish its validation message so that the Worker can start the asynchronous flow.

**Why P1**: The Catalog is the only service that owns request state.

**Acceptance Criteria**:

1. WHEN the Catalog receives valid `ownerUserId` and `sourceStorageKey` THEN it SHALL create one `ProcessingRequest` in `RECEIVED` state with a new `processingRequestId`.
2. WHEN a request is created THEN the Catalog SHALL publish `VideoValidationRequested` containing `eventId`, `processingRequestId`, `ownerUserId`, `sourceStorageKey`, and `occurredAt`.
3. IF the Catalog receives a previously processed `eventId` THEN it SHALL not create another request, transition state, or publish another event.
4. IF required creation input is absent THEN the Catalog SHALL reject creation without persisting a request or publishing an event.

**Independent Test**: Create a request and assert its state and emitted JSON fields; repeat an `eventId` and assert no second effect.

## Edge Cases

- IF an unsupported status transition is attempted in this slice THEN the Catalog SHALL reject it and retain `RECEIVED`.

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| CAT-01 | P1: Create and publish validation request | Tasks | Done |
| CAT-02 | P1: Create and publish validation request | Tasks | Done |
| CAT-03 | P1: Create and publish validation request | Tasks | Done |
| CAT-04 | P1: Create and publish validation request | Tasks | Done |

**Coverage:** 4 total, 4 mapped to future tasks, 0 unmapped.

## Success Criteria

- [ ] One valid command produces one `RECEIVED` request and one documented event.
- [ ] A repeated event has no additional effect.
