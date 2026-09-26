# API Hardening Tasks — catalog

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.** (In this project's sessions the skill is not registered by name; the user has authorized reading it from `.agents/skills/tlc-spec-driven/` by path.)

---

**Design**: `.specs/features/api-hardening/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec. Confirm before Execute. Guidelines found: none, so strong defaults apply. Same layers and commands as `upload-download/tasks.md` (S6). Candidate lessons applied as guidance:
> - L-002/L-003: spec precision on nulls and trimming.
> - L-004: state which value is matched.
> - L-005: bound client tokens stored under a unique index.
> - L-010: doubles raise what the real adapter raises.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Migration | integration | Index present after `runMigrations` and gone after revert; a duplicate `(owner, source)` insert is rejected; rows with a `NULL` key are covered | `test/*.e2e-spec.ts` (DB-guarded) | `DATABASE_HOST=localhost npm run test:e2e` |
| Repository port + in-memory adapter | unit | Lookup by owner and source; in-memory uniqueness raises `DuplicateSourceError`, including for `NULL`-key rows | `src/infrastructure/*.spec.ts` | `npm test` |
| TypeORM repository | integration | Lookup; `23505` on `uq_processing_request_owner_source` mapped to `DuplicateSourceError`; the key index still mapped to its own error; any other `23505` passes through | `test/*.e2e-spec.ts` (DB-guarded) | `DATABASE_HOST=localhost npm run test:e2e` |
| Use case | unit + integration | 1:1 to P1 ACs; the concurrency AC proven against PostgreSQL | `src/application/*.spec.ts`, `test/*.e2e-spec.ts` | both |
| Controller + route | e2e | Every P2 AC with its exact message, plus the S6 messages still intact; nothing written on any 400 | `test/*.e2e-spec.ts` | `npm run test:e2e` |

## Gate Check Commands

> Generated from codebase. Confirm before Execute. With `DATABASE_HOST` set, no e2e may be skipped. On this machine port 5432 is taken by another project: run PostgreSQL on another port with `db/init` mounted and set `DATABASE_PORT`.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Unit-only tasks | `npm test` |
| Full | Tasks with e2e/integration tests | `npm test && DATABASE_HOST=localhost npm run test:e2e` |
| Build | Last task of a phase | `npm run lint && npm run typecheck && npm test && DATABASE_HOST=localhost npm run test:e2e && npm run build` |

---

## Execution Plan

### Phase 1: One request per source — storage

```
T1 -> T3
T2 -> T3
```

### Phase 2: Behaviour at the edge

```
T4
T5
```

---

## Task Breakdown

### Phase 1: One request per source — storage

### T1: Add the unique `(owner, source)` index

**What**: Migration `1789957000000-UniqueOwnerSource` creates `uq_processing_request_owner_source` on `catalog.processing_request (owner_user_id, source_storage_key)`; `down` drops it.
**Where**: `src/infrastructure/persistence/migrations/1789957000000-UniqueOwnerSource.ts`
**Depends on**: None
**Reuses**: `1789956000000-AddIdempotencyKey.ts`, `test/idempotency-key-migration.e2e-spec.ts`
**Requirement**: HARD-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] After migrating, the index exists; after reverting, it does not; re-applying works
- [x] A second row with the same owner and source is rejected with `23505` on that index, also when both rows have a `NULL` key
- [x] Two owners with the same source string are both accepted
- [x] The test that pins the latest migration steps back past this one; its assertion is unchanged
- [x] Full gate passes; test count stated

**Tests**: integration
**Gate**: full

**Status**: ✅ Complete. Full gate green: unit 168, e2e 109 → 115 with 0 skipped. New suite `test/owner-source-migration.e2e-spec.ts` (6 tests). `test/idempotency-key-migration.e2e-spec.ts` now steps back past later migrations before its "last executed is S6's" assertion, which is kept as it was; `test/owner-index-migration.e2e-spec.ts` already did. Fixtures that gave one owner several requests for one source now give each request its own source, because the index forbids that data; no assertion was weakened: `idempotency-key-migration` (`insertWithKey` source per id), `owner-scoped-reads` (`ownedBy` source per id), `owned-processing-requests` (`seed` source per id; the leak check now names the two actual sources instead of the shared literal). A database that already holds duplicate sources, such as one left by the pre-T1 suites, fails the migration as the spec decides; the gate runs on a fresh container.

---

### T2: Look up by source and report a lost source race

**What**: Add `findByOwnerAndSource` and `DuplicateSourceError` to the port, and implement both in the in-memory adapter.
**Where**: `src/domain/processing-request.repository.ts` (+ `src/infrastructure/in-memory-processing-request.repository.ts`)
**Depends on**: None
**Reuses**: `DuplicateIdempotencyKeyError`, `findByOwnerAndIdempotencyKey`
**Requirement**: HARD-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] The lookup is owner-scoped: another owner's source finds nothing
- [x] In memory, saving a second request for one owner and source raises `DuplicateSourceError`, including when the keys are `NULL`; the duplicate-key case still raises `DuplicateIdempotencyKeyError`
- [x] Quick gate passes. `tsc` may be red until T3, because the TypeORM adapter must implement the new method; this is recorded in the task status, as in S6

**Tests**: unit
**Gate**: quick

**Status**: ✅ Complete. Quick gate green: unit 168 → 175. `DuplicateSourceError` is declared next to `DuplicateIdempotencyKeyError` in `src/domain/processing-request.repository.ts`. The in-memory `save` checks the key first, then the source, so a request that takes both still raises `DuplicateIdempotencyKeyError`, as the key check stays first in the use case. `tsc` stays red until T3 implements `findByOwnerAndSource` in the TypeORM adapter. Fixtures that saved several requests for one owner and one source now give each its own source; no assertion changed: `in-memory-processing-request.repository.spec.ts` (`ownedBy`, and the keyless-coexistence test passes two sources through a new optional `keyed` argument) and `list-owned-processing-requests.query.spec.ts` (`ownedBy`).

---

### T3: Implement the source lookup and mapping in PostgreSQL

**What**: The TypeORM repository implements `findByOwnerAndSource` and maps `23505` on `uq_processing_request_owner_source` to `DuplicateSourceError`.
**Where**: `src/infrastructure/persistence/typeorm-processing-request.repository.ts`
**Depends on**: T1, T2
**Reuses**: `isIdempotencyViolation`, generalised by constraint name
**Requirement**: HARD-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Against PostgreSQL: the lookup returns the owner's request and nothing for another owner
- [x] A duplicate source raises `DuplicateSourceError`; a duplicate key still raises `DuplicateIdempotencyKeyError`; a duplicate primary key still passes through unchanged
- [x] Build gate passes (typecheck green again)

**Tests**: integration
**Gate**: build

**Status**: ✅ Complete. Build gate green on a fresh container: lint, typecheck, unit 175, e2e 115 → 118 with 0 skipped, build. `tsc` is green again. `isIdempotencyViolation` became `violatedUniqueIndex`, which returns the constraint of a `23505`; `save` maps `uq_processing_request_owner_idempotency` and `uq_processing_request_owner_source` each to its own error and rethrows anything else. The new key-only test takes the key under another source, so it proves the key mapping without relying on which of two violated indexes PostgreSQL reports. The existing primary-key test in `test/persistence.e2e-spec.ts` gained one assertion, `not.toBeInstanceOf(DuplicateSourceError)`; nothing was removed.

---

### Phase 2: Behaviour at the edge

### T4: Return the existing request for a known source

**What**: After the key lookup misses, the create use case looks up `(owner, source)` and returns `replayed`. A `DuplicateSourceError` from the transaction is re-read by source outside it.
**Where**: `src/application/create-processing-request.use-case.ts`
**Depends on**: None (Phase 1 complete)
**Reuses**: The S6 lost-race branch; `test/idempotent-creation.e2e-spec.ts`; `test/create-processing-request-route.e2e-spec.ts`
**Requirement**: HARD-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Unit: new key with a known source → `replayed` with that request, and no row, outbox entry or processed-event record is written
- [x] Unit: a key bound to another source still gives `IdempotencyConflictError`, even when the new source already has a request
- [x] Unit: a pre-S6 request with a `NULL` key and the same source is returned
- [x] PostgreSQL:
  - two concurrent creates with different keys on one source → one row, one outbox entry, and the same id on both
  - a burst of 8 on one source → one row
  - a loser forced past the lookup raises `DuplicateSourceError` and returns the winner
- [x] Route: K1 → `201`; K2 with the same source → `200` with a body identical to the `201`; rows 1, outbox 1
- [x] Discrimination: removing the source lookup or the source re-read turns a test red
- [x] Full gate passes

**Tests**: unit + integration
**Gate**: full

**Status**: ✅ Complete. Full gate green: unit 175 → 179, e2e 118 → 122 with 0 skipped. After the key lookup misses, `findByOwnerAndSource` answers `replayed`; a `DuplicateSourceError` from the transaction is re-read by source outside it and rethrown if the re-read finds nothing. The key check stays first. Discrimination, run in scratch and reverted: ignoring the source lookup's result turns the unit "new key on a known source" test red (it asserts no insert is attempted); disabling the source re-read turns the unit source-race test and all three PostgreSQL source tests red. Existing tests changed: the S6 forced-loser tests (unit and `test/idempotent-creation.e2e-spec.ts`) now also force `findByOwnerAndSource` to miss once. A create that read before the winner committed misses both lookups; without this the new source lookup answers them and they would no longer reach the key index. Their assertions are unchanged.

---

### T5: Reject malformed create input with a 400

**What**: `validateDto` checks, per field, in this order: required, then string, then not blank; for `idempotencyKey` only, then at most 255 characters.
**Where**: `src/interface/create-processing-request.controller.ts`
**Depends on**: None (Phase 1 complete)
**Reuses**: The existing messages and `test/create-processing-request-route.e2e-spec.ts`
**Requirement**: HARD-10, HARD-11

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A 256-character key → `400 idempotencyKey must be at most 255 characters`; a 255-character key → `201`
- [ ] A number, an array, an object and `true` for each of the three fields → `400 <field> must be a string`. The near-miss inputs are a numeric string (accepted) and `null` (`<field> is required`)
- [ ] Every S6 message is unchanged: missing, empty and blank still give `<field> is required`
- [ ] No row and no outbox entry after any of these `400`s
- [ ] Build gate passes

**Tests**: e2e
**Gate**: build

---

## Phase Execution Map

```
Phase 1 (T1 T2 T3) then Phase 2 (T4 T5)
```

5 tasks: **Phase 1** (3) and **Phase 2** (2). Cross-repository order: this repository first, then `fiap-x-api`. `fiap-x-platform` regenerates the database script in spec C.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: Migration | 1 file | ✅ Granular |
| T2: Port + in-memory adapter | 1 port method and 1 error, implemented by the in-memory adapter | ⚠️ OK - cohesive; a port method lands with its reference adapter (S6 T2 precedent) |
| T3: TypeORM lookup + mapping | 1 file | ✅ Granular |
| T4: Use case source branch | 1 file | ✅ Granular |
| T5: Controller validation | 1 function | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows (within phase) | Status |
| --- | --- | --- | --- |
| T1 | None | — | ✅ Match |
| T2 | None | — | ✅ Match |
| T3 | T1, T2 | T1 → T3, T2 → T3 | ✅ Match |
| T4 | None (Phase 1 complete) | — | ✅ Match |
| T5 | None (Phase 1 complete) | — | ✅ Match |

No task depends on a later phase.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Migration | integration | integration | ✅ OK |
| T2 | Repository port + in-memory adapter | unit | unit | ✅ OK |
| T3 | TypeORM repository | integration | integration | ✅ OK |
| T4 | Use case | unit + integration | unit + integration | ✅ OK |
| T5 | Controller + route | e2e | e2e | ✅ OK |
