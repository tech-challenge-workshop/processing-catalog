# API Hardening Specification — catalog

## Problem Statement

The Catalog deduplicates creation per `(owner, idempotencyKey)` only, so the same upload confirmed with two keys becomes two Processing Requests for one video (V32). Its create endpoint also answers `500` to two malformed inputs the S6 Verifier found: a key long enough to overflow the unique index, which fails on every retry (V26), and a field that is not a string (V27). The API is the only caller and already caps the key, but the Catalog's contract should not depend on that.

## Goals

- [ ] One source key yields at most one Processing Request per owner, under concurrency
- [ ] Every malformed create input is a `400`, never a `500`

## Out of Scope

| Feature | Reason |
| --- | --- |
| Binding the second key to the existing request | Decided in the API half: the second key stays unused |
| Stripping whitespace from the key | The key is matched exactly (S6 design); only blank keys are rejected |
| Relay, state-machine and retry hardening (V5, V7, V13) | Spec A (`catalog-messaging-hardening`) |

---

## Assumptions & Open Questions

Decisions of 2026-09-26 are in the API half's spec. V26 and V27 move here from spec A because they touch the same endpoint.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Same owner and source, different key (V32) | `200` with the existing request, nothing written | Decided: one request per upload | y |
| Same key, same source | Unchanged: `200` replay | S6 behaviour | y |
| Same key, different source | Unchanged: `409` | S6 behaviour; the key check comes first | y |
| Concurrency guarantee for one source | A unique constraint on `(owner_user_id, source_storage_key)`; the loser returns the winner's request | Same mechanism as the key's unique index (S6); a lookup alone races | y |
| Existing duplicate sources in a database | The migration fails and names the constraint | Only local databases predate S6 and they are recreated with `down -v`; silently merging requests would be worse | y |
| Maximum key length (V26) | 255 characters; longer → `400 idempotencyKey must be at most 255 characters` | Matches the API's header limit | y |
| Non-string field (V27) | `400 <field> must be a string` for `ownerUserId`, `sourceStorageKey` and `idempotencyKey` | Names the field and the problem, like the existing messages | y |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: One request per source ⭐ MVP

**User Story**: As the API, I want a create for a source the owner already has to return that request so that one upload is never processed twice.

**Why P1**: It is what makes the API's HARD-02 true.

**Acceptance Criteria**:

1. WHEN the owner creates with a new key and a `sourceStorageKey` that already has a request of that owner THEN the Catalog SHALL respond `200` with that request.
2. WHEN that happens THEN the Catalog SHALL write nothing: no row and no outbox entry.
3. WHEN two creates with different keys and the same owner and source arrive concurrently THEN exactly one request and one outbox entry SHALL exist, and both responses SHALL carry its id.
4. IF the key is already bound to a different source THEN the Catalog SHALL still respond `409`.

**Independent Test**: Against PostgreSQL: create with K1 (`201`), with K2 and the same source (`200`, same id, one row, one outbox entry); two concurrent creates with K3 and K4 on a new source leave one row.

---

### P2: Malformed input is a 400 ⭐ MVP

**User Story**: As a caller, I want every malformed create rejected with a `400` naming the field so that a bad request never looks like a server fault.

**Why P2**: A `500` on every retry is indistinguishable from an outage.

**Acceptance Criteria**:

1. IF `idempotencyKey` is longer than 255 characters THEN the Catalog SHALL respond `400` with `idempotencyKey must be at most 255 characters` and SHALL write nothing.
2. WHEN `idempotencyKey` is exactly 255 characters THEN the Catalog SHALL accept it.
3. IF `ownerUserId`, `sourceStorageKey` or `idempotencyKey` is present but not a string THEN the Catalog SHALL respond `400` with `<field> must be a string` and SHALL write nothing.

**Independent Test**: Post a 256-character key, then a numeric key, then an array owner: three `400`s with those messages, no rows.

---

## Edge Cases

- WHEN a pre-S6 row with a `NULL` key shares a source with a new create THEN the new create SHALL return that row with `200`.
- IF the unique constraint on the source rejects an insert THEN the Catalog SHALL return the existing request, not an error.

---

## Requirement Traceability

`HARD-` is shared: `fiap-x-api` owns `HARD-01` to `HARD-08`, this service `HARD-09` to `HARD-11`.

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| HARD-09 | P1: One request per source (V32) | Tasks | In Tasks |
| HARD-10 | P2: Key length bounded (V26) | Tasks | In Tasks |
| HARD-11 | P2: Non-string fields rejected (V27) | Tasks | In Tasks |

**ID format:** `[CATEGORY]-[NUMBER]`

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 3 total, 3 mapped to tasks, 0 unmapped

---

## Success Criteria

- [ ] Two keys on one source leave one row and one outbox entry
- [ ] No malformed create reaches a `500`

---

## Dependencies

None to build. `fiap-x-api` HARD-02 depends on HARD-09; `fiap-x-platform` regenerates the database script from the new migration (spec C).
