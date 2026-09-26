# Upload and Download Tasks — catalog

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.** (In this project's sessions the skill is not registered by name; the user has authorized reading it from `.agents/skills/tlc-spec-driven/` by path.)

---

**Design**: `.specs/features/upload-download/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: none - strong defaults applied. Same layers and commands as `auth-owner-scope/tasks.md` (S5), plus candidate lessons L-002/L-003 (spec precision on nulls and trimming) as guidance.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Migration + entity | integration | Column and unique index present after `runMigrations`, gone after revert; pre-S6 rows unaffected | `test/*.e2e-spec.ts` (DB-guarded) | `DATABASE_HOST=localhost npm run test:e2e` |
| Repository port + in-memory adapter | unit | Lookup by owner and key; in-memory uniqueness raises the same error as PostgreSQL | `src/infrastructure/*.spec.ts` | `npm test` |
| TypeORM repository | integration | Lookup; `23505` on the unique index mapped to `DuplicateIdempotencyKeyError` | `test/*.e2e-spec.ts` (DB-guarded) | `DATABASE_HOST=localhost npm run test:e2e` |
| Use case | unit + integration | 1:1 to P1 ACs; the concurrency AC proven only against PostgreSQL | `src/application/*.spec.ts`, `test/*.e2e-spec.ts` | both |
| Controllers + routes | e2e | Every route: 201/200/409/400 for create; 200/409/404 for archive; constant 404 body | `test/*.e2e-spec.ts` | `npm run test:e2e` |

## Gate Check Commands

> Generated from codebase - confirm before Execute. With `DATABASE_HOST` set, no e2e may be skipped. On this machine port 5432 is taken by another project: run PostgreSQL on another port and set `DATABASE_PORT` (S5 precedent).

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Unit-only tasks | `npm test` |
| Full | Tasks with e2e/integration tests | `npm test && DATABASE_HOST=localhost npm run test:e2e` |
| Build | Last task of a phase | `npm run lint && npm run typecheck && npm test && DATABASE_HOST=localhost npm run test:e2e && npm run build` |

---

## Execution Plan

### Phase 1: The idempotency key in the data layer

```
T1 -> T3
T2 -> T3
```

### Phase 2: Idempotent creation and the archive route

```
T4 -> T5
T6
```

---

## Task Breakdown

### Phase 1: The idempotency key in the data layer

### T1: Store the idempotency key with its unique index

**What**: Migration `1789956000000-AddIdempotencyKey` (nullable `idempotency_key`, unique `(owner_user_id, idempotency_key)`), the entity column, and `idempotencyKey` on the domain model and `createProcessingRequest`.
**Where**: `src/infrastructure/persistence/migrations/1789956000000-AddIdempotencyKey.ts`
**Depends on**: None
**Reuses**: The S5 index migration's `IF [NOT] EXISTS` style
**Requirement**: UPL-14

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] After `runMigrations`, the column exists and `pg_indexes` shows `uq_processing_request_owner_idempotency`; after revert, neither
- [ ] A pre-existing row with `NULL` key survives and does not block inserts; two `NULL`-key rows for one owner coexist
- [ ] Running migrations twice leaves nothing pending
- [ ] Full gate passes, 0 skipped

**Tests**: integration
**Gate**: full

---

### T2: Look up by owner and key, and enforce uniqueness in memory

**What**: `findByOwnerAndIdempotencyKey(owner, key)` on the port and in the in-memory repository; in-memory `save` raises `DuplicateIdempotencyKeyError` on a duplicate `(owner, key)`.
**Where**: `src/domain/processing-request.repository.ts`
**Depends on**: None
**Reuses**: In-memory storage map
**Requirement**: UPL-11, UPL-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Lookup returns the owner's request for the key and `undefined` for another owner's same key
- [ ] Duplicate save raises `DuplicateIdempotencyKeyError`; the same key for another owner does not
- [ ] Quick gate passes; at least 5 new tests

**Tests**: unit
**Gate**: quick

---

### T3: Implement the lookup and map the unique violation in PostgreSQL

**What**: TypeORM `findByOwnerAndIdempotencyKey`; `save` maps a `23505` on `uq_processing_request_owner_idempotency` to `DuplicateIdempotencyKeyError` (any other error propagates).
**Where**: `src/infrastructure/persistence/typeorm-processing-request.repository.ts`
**Depends on**: T1, T2
**Reuses**: `notification-service`'s `23505` handling
**Requirement**: UPL-11, UPL-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Against PostgreSQL: lookup by owner and key; a duplicate insert raises `DuplicateIdempotencyKeyError`; a `23505` on another constraint is not mapped
- [ ] Build gate passes, 0 skipped

**Tests**: integration
**Gate**: build

---

### Phase 2: Idempotent creation and the archive route

### T4: Make creation idempotent in the use case

**What**: `CreateProcessingRequestUseCase` requires `idempotencyKey`, returns `{ request, outcome: 'created' | 'replayed' }`, raises `IdempotencyConflictError` for a key bound to another source, and on `DuplicateIdempotencyKeyError` re-reads the winner outside the rolled-back transaction.
**Where**: `src/application/create-processing-request.use-case.ts`
**Depends on**: None
**Reuses**: Unit of work, outbox
**Requirement**: UPL-11, UPL-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Unit: created → one save and one outbox entry; replay with same source → no write; other source → conflict, no write; blank key → domain error
- [ ] PostgreSQL e2e: two concurrent creates with one owner and key → one row, one outbox entry, both results carry the same id; a third later → replayed, still one row and one outbox entry
- [ ] Two owners with the same key string → two requests
- [ ] Full gate passes, 0 skipped

**Tests**: integration
**Gate**: full

---

### T5: Answer 201, 200 or 409 on create

**What**: `CreateProcessingRequestController` requires `idempotencyKey` (400 if missing/blank), maps `created` → 201, `replayed` → 200 (same body shape), conflict → 409.
**Where**: `src/interface/create-processing-request.controller.ts`
**Depends on**: T4
**Reuses**: Existing controller and DTO
**Requirement**: UPL-11, UPL-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] e2e: 201 then 200 with the same `processingRequestId`; 409 for another source; 400 without the key; existing create tests updated to send a key (each change listed, no assertion weakened)
- [ ] Build gate passes, 0 skipped

**Tests**: e2e
**Gate**: build

---

### T6: Serve the archive key to the owner of a completed request

**What**: `GetOwnedArchiveQuery` and `GET /owners/:ownerUserId/processing-requests/:id/archive` in `OwnedProcessingRequestsController`.
**Where**: `src/interface/owned-processing-requests.controller.ts`
**Depends on**: None
**Reuses**: `findByIdAndOwner`, UUID guard, constant 404
**Requirement**: UPL-13

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] e2e against PostgreSQL: `COMPLETED` → `200 { zipStorageKey }` (exact key); owned but not completed → 409; another owner, random UUID, malformed id → the constant 404 body byte-identical
- [ ] The owner-scoped list and read still carry no `zipStorageKey`
- [ ] Build gate passes, 0 skipped

**Tests**: e2e
**Gate**: build

---

## Phase Execution Map

```
Phase 1 (T1 T2 T3) then Phase 2 (T4 T5 T6)
```

6 tasks fit one batch. Cross-repository order for S6: this repository first, then `fiap-x-api`, then `fiap-x-platform`.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: Migration + entity + domain field | 1 migration and the field it stores | ⚠️ OK - cohesive; the column is untestable without its mapping |
| T2: Port lookup + in-memory uniqueness | 1 method, its double | ✅ Granular |
| T3: TypeORM lookup + violation mapping | 1 class | ✅ Granular |
| T4: Idempotent use case | 1 class | ✅ Granular |
| T5: Create status mapping | 1 controller | ✅ Granular |
| T6: Archive route | 1 query + 1 route | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows (within phase) | Status |
| --- | --- | --- | --- |
| T1 | None | — | ✅ Match |
| T2 | None | — | ✅ Match |
| T3 | T1, T2 | T1 → T3, T2 → T3 | ✅ Match |
| T4 | None | — | ✅ Match |
| T5 | T4 | T4 → T5 | ✅ Match |
| T6 | None | — | ✅ Match |

No task depends on a later phase.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Migration + entity | integration | integration | ✅ OK |
| T2 | Repository port + in-memory adapter | unit | unit | ✅ OK |
| T3 | TypeORM repository | integration | integration | ✅ OK |
| T4 | Use case | unit + integration | integration | ✅ OK |
| T5 | Controllers + routes | e2e | e2e | ✅ OK |
| T6 | Controllers + routes | e2e | e2e | ✅ OK |
