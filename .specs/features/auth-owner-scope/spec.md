# Auth and Owner Scope Specification — catalog

## Problem Statement

The Catalog can only answer "give me request X": `GET /processing-requests/:id` (`src/interface/processing-request-observation.controller.ts`) returns any request to anyone, and it is mounted only in local integration mode. The API now needs to list one user's requests and read one of them on that user's behalf (RF-4), and the foundation fixes where the filter lives: the API queries the Catalog filtered by `ownerUserId`. A filter applied after loading every request would be one bug away from leaking another user's data; it belongs in the query.

## Goals

- [ ] The Catalog answers owner-scoped reads — a page of one owner's requests and one request for its owner — in production mode, not only in local integration mode
- [ ] No Catalog query can return a request to an owner other than its own

## Out of Scope

| Feature | Reason |
| --- | --- |
| Validating JWTs | The API validates tokens and passes the owner (`docs/foudation.md`); the Catalog trusts the API on the internal network |
| The user-facing response shape and HTTP error mapping | `fiap-x-api` projects and maps (AUTH-05 to AUTH-09) |
| Changing the existing observation endpoint | The local smoke and integration tests use it; it stays local-only and unscoped as it is |
| Filtering by status, full-text search | Not requested |

---

## Assumptions & Open Questions

Decisions from the gray-area discussion of 2026-09-26 are in `fiap-x-platform/.specs/features/auth-owner-scope/context.md`.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| How the owner reaches the Catalog | A path segment: `GET /owners/:ownerUserId/processing-requests` and `GET /owners/:ownerUserId/processing-requests/:id` | The API is the only caller; with the owner in the path an unscoped query is not even a route, and the routes cannot be confused with the local-only observation endpoint | y |
| Where the filter is applied | In the repository query (`WHERE owner_user_id = $1`), using the existing `idx_processing_request_owner` index | A filter after loading would leak on any bug in between, and would not scale | y |
| Pagination contract | `page` and `pageSize` validated here too (≥ 1; 1–100), ordered by `created_at` descending then `processing_request_id`, with a `total` count | The Catalog must not trust its caller for bounds any more than for identity; the tiebreak makes the order total so pages never repeat or skip a row | y |
| Where `failureReason` comes from | The Catalog maps `failureCode` to the safe sentence with `failureReasonFor`, the same function the terminal event uses | One source of truth for the sentence; the API must not re-implement the mapping | y |
| Another owner's request by id | `404`, identical to a missing request | The Catalog must not be the oracle the API avoids being | y |
| Storage keys in the Catalog's response | Omitted from the owner-scoped responses | The API would drop them anyway; not sending them removes a way to leak them | y |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: One owner's requests, one page at a time ⭐ MVP

**User Story**: As the API, I want a page of one owner's requests so that I can serve a user's list without ever seeing anyone else's.

**Why P1**: RF-4 has no backing query today.

**Acceptance Criteria**:

1. WHEN the Catalog receives `GET /owners/<owner>/processing-requests?page=<p>&pageSize=<n>` THEN it SHALL return only requests whose `ownerUserId` equals `<owner>`.
2. The Catalog SHALL apply the owner filter in the repository query, not after loading requests.
3. WHEN the page is returned THEN it SHALL be ordered by `createdAt` descending, then by `processingRequestId`, and SHALL contain at most `pageSize` items starting at offset `(page - 1) * pageSize`.
4. WHEN the page is returned THEN the body SHALL be `{ items, page, pageSize, total }`, where `total` counts all of that owner's requests.
5. WHEN a request is returned THEN its item SHALL contain `processingRequestId`, `status`, `createdAt`, `updatedAt`, and `failureReason` if and only if `status` is `FAILED`, where `failureReason` is `failureReasonFor(failureCode)`.
6. The owner-scoped responses SHALL NOT contain `sourceStorageKey`, `zipStorageKey` or `attemptId`.
7. IF the `<owner>` path segment is blank after trimming THEN the Catalog SHALL respond `400` and SHALL NOT query the repository.
8. IF `page` or `pageSize` is out of range or not an integer THEN the Catalog SHALL respond `400` naming the parameter.
9. The owner-scoped endpoints SHALL be available whether or not `LOCAL_INTEGRATION` is set.

**Independent Test**: Seed requests for two owners in PostgreSQL; a page for one owner contains only theirs, in order, with the right `total`.

---

### P2: One request, for its owner only ⭐ MVP

**User Story**: As the API, I want one request by id for a given owner so that a user can read theirs and nobody else's.

**Why P2**: The API's `404`-for-others rule is only safe if the Catalog enforces it too.

**Acceptance Criteria**:

1. WHEN the Catalog receives `GET /owners/<owner>/processing-requests/<id>` and the request belongs to `<owner>` THEN it SHALL respond `200` with the item shape of P1 AC5.
2. IF the request belongs to another owner THEN the Catalog SHALL respond `404` with the same body as for a missing request.
3. IF no request has that id, or the id is not a UUID THEN the Catalog SHALL respond `404`.
4. The Catalog SHALL look the request up by id and owner in the same repository query.

**Independent Test**: A request owned by `alice` is returned for `alice` and is a `404` for `bob`, byte-identical to a random id's `404`.

---

## Edge Cases

- WHEN an owner has no requests THEN the page SHALL be `items: []`, `total: 0`.
- WHEN `page` is beyond the last page THEN `items` SHALL be empty and `total` SHALL be the owner's count.
- WHEN two requests share a `createdAt` THEN their order SHALL be stable across calls (the `processingRequestId` tiebreak).

---

## Requirement Traceability

`AUTH-` is shared: `fiap-x-api` owns `AUTH-01` to `AUTH-09`, this service `AUTH-10` to `AUTH-13`, `fiap-x-platform` `AUTH-14` to `AUTH-17`.

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| AUTH-10 | P1: One owner's requests, one page at a time | Design | Pending |
| AUTH-11 | P1: One owner's requests, one page at a time | Design | Pending |
| AUTH-12 | P2: One request, for its owner only | Design | Pending |
| AUTH-13 | P1–P2: owner-scoped responses expose no storage keys | Design | Pending |

**ID format:** `[CATEGORY]-[NUMBER]`

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 4 total, 0 mapped to tasks, 4 unmapped ⚠️

---

## Success Criteria

- [ ] Against PostgreSQL, two owners' pages are disjoint and complete, and `total` matches each owner's count
- [ ] Another owner's id and a random id produce identical `404` responses
- [ ] The endpoints answer with `LOCAL_INTEGRATION` unset

---

## Dependencies

None to build. `fiap-x-api` consumes these endpoints; `fiap-x-platform`'s smoke proves the whole path.
