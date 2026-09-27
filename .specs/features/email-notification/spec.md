# Email Notification — Catalog Specification

## Problem Statement

`ProcessingRequest` has no address to notify, and the terminal event this service publishes carries only `ownerUserId` — a `sub`, not something SMTP can use. By AD-015, the address is resolved once, at the API, from the token's own `email` claim; this service's job is only to hold it and hand it to the one event that needs it.

## Goals

- [ ] Persist the caller-supplied `ownerEmail` on `ProcessingRequest` at creation.
- [ ] Carry it on the terminal event only — `COMPLETED` or `FAILED` — and nowhere else.

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
| --- | --- |
| Sending email | Owned by `notification-service`. |
| Validating the email's format | The API already derived it from an authenticated token; this service trusts it the way it already trusts `ownerUserId`. |
| Adding it to `VideoValidationRequested`, `ProcessingQueued`, or `ProcessingStarted` | The Worker consumes those and has no use for it; adding it there only widens the PII surface for no reason. |
| Backfilling existing rows | Local-dev only, no production data; a fresh migration with a `NOT NULL` column is enough (see `db/init` reset policy in `fiap-x-platform`). |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here - nothing is left silently unclear.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Column nullability | `owner_email` is `NOT NULL`, no default | No legacy rows to accommodate (unlike `idempotency_key`, which had to stay nullable for pre-S6 requests); every request from this feature forward has one | y |
| Validation depth | Non-blank string, bounded length, same style as `ownerUserId` and `sourceStorageKey` | Format checking is the API's job; this service only guards against empty/oversized values corrupting a btree index, exactly like its siblings | y |
| Idempotent replay | The stored value from first creation wins; a replay's body is never used to overwrite it | Matches the existing rule for `sourceStorageKey` — the first write is authoritative, a replay only reads it back | y |

**Open questions:** none.

---

## User Stories

### P1: Persist the owner's email at creation ⭐ MVP

**User Story**: As the system, I want the request's owner email stored the moment the request exists, so that the terminal event always has one to carry.

**Why P1**: Nothing else in this slice has a value to work with otherwise.

**Acceptance Criteria** (each line is one EARS pattern):

1. WHEN a Processing Request is created THEN it SHALL store the caller-supplied `ownerEmail`. <!-- event-driven -->
2. IF `ownerEmail` is missing or blank THEN creation SHALL be rejected with the same validation-error shape as `ownerUserId` and `sourceStorageKey`. <!-- unwanted-behavior -->

**Independent Test**: Create a request with a valid email, read it back and assert the field; create one with a blank email and assert the rejection, with nothing written.

---

### P2: Carry it on the terminal event only

**User Story**: As `notification-service`, I want the terminal event to carry the address I need, so that I never have to ask anything else for it.

**Why P2**: Depends on P1's value existing to carry.

**Acceptance Criteria**:

1. WHEN the Catalog publishes a terminal event (`COMPLETED` or `FAILED`) THEN it SHALL include the request's `ownerEmail`. <!-- event-driven -->
2. The Catalog SHALL NOT include `ownerEmail` on `VideoValidationRequested`, `ProcessingQueued`, or `ProcessingStarted`. <!-- ubiquitous -->
3. WHEN an upload confirmation is replayed under the same `Idempotency-Key` THEN the request's stored `ownerEmail` SHALL remain the one recorded at first creation, regardless of what the replay's body carries. <!-- event-driven -->

**Independent Test**: Drive a request to each terminal status and inspect the outbox row for `ownerEmail`; inspect an intermediate event's outbox row and assert the field is absent; replay a create with a different email in the body and assert the stored value is unchanged.

---

## Edge Cases

- IF two concurrent creates race for the same source or idempotency key (the existing race handled by `DuplicateSourceError`/`DuplicateIdempotencyKeyError`) THEN the winner's `ownerEmail` is the one that survives, exactly as its `sourceStorageKey` already does today.
- WHEN a terminal event is republished because an earlier delivery attempt was never confirmed by the broker (the outbox retry path) THEN it SHALL carry the same `ownerEmail` as the first attempt — it is read from the same persisted request, not recomputed.

---

## Requirement Traceability

`EN-` is shared across this feature: `fiap-x-api` owns `EN-01` to `EN-05`, this service owns `EN-06` to `EN-10`, `notification-service` owns `EN-11` to `EN-21`, `fiap-x-platform` owns `EN-22` to `EN-26`.

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| EN-06 | P1: Persist ownerEmail | Design | Pending |
| EN-07 | P1: Persist ownerEmail | Design | Pending |
| EN-08 | P2: Carry it on the terminal event | Design | Pending |
| EN-09 | P2: Carry it on the terminal event | Design | Pending |
| EN-10 | P2: Carry it on the terminal event | Design | Pending |

**ID format:** `EN-[NUMBER]`

**Coverage:** 5 total, 0 mapped to tasks, 5 unmapped (mapping happens in Tasks).

---

## Success Criteria

- [ ] Every request created through this slice has a stored `ownerEmail`.
- [ ] The terminal event, and only the terminal event, carries it.
- [ ] A replay never lets a second body value overwrite the first.
