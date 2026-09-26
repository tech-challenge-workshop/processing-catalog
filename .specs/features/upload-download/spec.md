# Upload and Download Specification — catalog

## Problem Statement

Two things S6 needs live in the Catalog, the only service with durable state. Confirmation must be idempotent for as long as the request exists — so the `Idempotency-Key` has to be stored with the request, under a constraint two concurrent confirmations cannot both pass. And the download needs the archive key of a completed request, which the owner-scoped reads deliberately never return (AUTH-13): the API needs a narrow, owner-scoped way to get it without the key ever reaching a user-facing payload.

## Goals

- [ ] Creating a request with an owner's `Idempotency-Key` is idempotent forever and safe under concurrency
- [ ] The API can obtain a completed request's archive key for its owner, and for nobody else

## Out of Scope

| Feature | Reason |
| --- | --- |
| Presigned URLs, upload validation, the user contract | `fiap-x-api` (UPL-01 to UPL-10) |
| Purging idempotency keys | Discussed: remembered for as long as the request exists |
| Changing the owner-scoped reads | They stay key-free (AUTH-13) |

---

## Assumptions & Open Questions

Decisions from the gray-area discussion of 2026-09-26 are in `fiap-x-platform/.specs/features/upload-download/context.md`.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Where the key lives | A nullable `idempotency_key` column on `processing_request`, with a unique index on `(owner_user_id, idempotency_key)` | Discussed: remembered as long as the request exists; per owner; the unique index is what makes concurrency safe | y |
| What makes a replay "the same" | Same owner, same key, same `sourceStorageKey` | The source key identifies the upload; anything else bound to the key is a different upload | y |
| How the create endpoint signals a replay | `201` when created, `200` with the existing request when replayed, `409` on a key bound to another source | The API maps these one-to-one to its own responses | y |
| Is the key mandatory on create | Yes: `idempotencyKey` is required | The API is the only caller and always has one; there is no create path without an upload anymore | y |
| Existing rows | The column is nullable; rows created before S6 keep `NULL` | They were created without a key; a unique index ignores `NULL`s in PostgreSQL | y |
| How the API gets the archive key | `GET /owners/:ownerUserId/processing-requests/:id/archive` → `{ zipStorageKey }` for a `COMPLETED` request; `409` if not completed; the constant `404` otherwise | Owner-scoped like the other reads; a separate route keeps the key out of every item-shaped payload (AUTH-13) | y |
| Idempotency and the outbox | A replay writes nothing — no second transition, no second `VideoValidationRequested` | Otherwise a retried confirmation would start a second processing operation | y |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Idempotent creation ⭐ MVP

**User Story**: As the API, I want to create a request with the owner's idempotency key so that a retried confirmation never creates a second one.

**Why P1**: The API's "exactly once" (UPL-04, UPL-05) is only as strong as this.

**Acceptance Criteria**:

1. WHEN the Catalog receives `POST /processing-requests {ownerUserId, sourceStorageKey, idempotencyKey}` with a key the owner has not used THEN it SHALL create the request and its `VideoValidationRequested` in one transaction and respond `201`.
2. WHEN the same owner sends the same key with the same `sourceStorageKey` THEN the Catalog SHALL respond `200` with the existing request and SHALL write nothing — no row, no outbox entry.
3. IF the same owner sends the same key with a different `sourceStorageKey` THEN the Catalog SHALL respond `409` and SHALL write nothing.
4. WHEN two creates with the same owner and key arrive concurrently THEN exactly one request and one outbox entry SHALL exist, and both responses SHALL carry its id.
5. WHEN two different owners use the same key string THEN each SHALL get their own request.
6. IF `idempotencyKey` is missing or blank THEN the Catalog SHALL respond `400` and SHALL write nothing.

**Independent Test**: Against PostgreSQL, fire the same create twice concurrently and once more afterwards: one row, one outbox entry, three responses with the same id.

---

### P2: The archive key, for its owner only ⭐ MVP

**User Story**: As the API, I want a completed request's archive key for its owner so that I can issue a download URL.

**Why P2**: The download (UPL-07) has no other source for the key.

**Acceptance Criteria**:

1. WHEN the Catalog receives `GET /owners/<owner>/processing-requests/<id>/archive` for a `COMPLETED` request of that owner THEN it SHALL respond `200 { zipStorageKey }`.
2. IF the request belongs to that owner but is not `COMPLETED` THEN it SHALL respond `409`.
3. IF the request belongs to another owner, does not exist, or the id is not a UUID THEN it SHALL respond with the constant `404` of the owner-scoped reads.
4. The owner-scoped list and read SHALL still not contain `zipStorageKey`.

**Independent Test**: A completed request of `alice` yields its key to `alice`; `bob` gets the constant `404`; a `QUEUED` one yields `409`.

---

## Edge Cases

- WHEN an existing pre-S6 row has a `NULL` key THEN creates with any key SHALL be unaffected by it.
- IF the unique constraint rejects a concurrent insert THEN the Catalog SHALL return the winner's request rather than an error.

---

## Requirement Traceability

`UPL-` is shared: `fiap-x-api` owns `UPL-01` to `UPL-10`, this service `UPL-11` to `UPL-14`, `fiap-x-platform` `UPL-15` to `UPL-18`.

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| UPL-11 | P1: Idempotent creation | Execute | Implementing |
| UPL-12 | P1: Idempotent creation | Execute | Implementing |
| UPL-13 | P2: The archive key, for its owner only | Execute | Implementing |
| UPL-14 | P1: Idempotent creation (schema and migration) | Execute | Implementing |

**ID format:** `[CATEGORY]-[NUMBER]`

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 4 total, 4 mapped to tasks, 0 unmapped

---

## Success Criteria

- [ ] Concurrent and repeated creates with one key leave one row and one outbox entry
- [ ] The archive route answers only the owner of a completed request

---

## Dependencies

None to build. `fiap-x-api` consumes both; `fiap-x-platform` regenerates the database script from the new migration.
