# Auth and Owner Scope Tasks — catalog

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.** (In this project's sessions the skill is not registered by name; the user has authorized reading it from `.agents/skills/tlc-spec-driven/` by path.)

---

**Design**: `.specs/features/auth-owner-scope/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: none - strong defaults applied (no `AGENTS.md`, `CONTRIBUTING.md` or coverage threshold). Samples: `src/**/*.spec.ts` (unit, in-memory adapters), `test/*.e2e-spec.ts` (e2e; database suites guarded by `DATABASE_HOST`, which CI now sets and forbids skipping). Commands from `package.json` and `.github/workflows/ci.yml`.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Repository port + in-memory adapter | unit | Every new method: owner filter, order with tiebreak, offset/limit, count, id-and-owner lookup, empty results | `src/infrastructure/*.spec.ts` | `npm test` |
| TypeORM repository | integration | The same paths against PostgreSQL, plus two owners' disjointness and equal-`createdAt` ordering | `test/*.e2e-spec.ts` (DB-guarded) | `DATABASE_HOST=localhost npm run test:e2e` |
| Migration | integration | Index present after `runMigrations`, old index gone, `down()` restores it | `test/*.e2e-spec.ts` (DB-guarded) | `DATABASE_HOST=localhost npm run test:e2e` |
| Application queries + item projection | unit | 1:1 to spec ACs P1.3–P1.6, P2.1; `failureReason` iff `FAILED`; no storage keys | `src/application/*.spec.ts` | `npm test` |
| Controller + module wiring | e2e | Both routes: happy path, every listed edge case, every 400 and 404 path; available without `LOCAL_INTEGRATION` | `test/*.e2e-spec.ts` | `npm run test:e2e` |

## Gate Check Commands

> Generated from codebase - confirm before Execute. Database suites need PostgreSQL bootstrapped from `fiap-x-platform/db/init/01-schemas.sql` (e.g. the platform's compose `postgres`); with `DATABASE_HOST` set, no e2e test may be skipped.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Unit-only tasks | `npm test` |
| Full | Tasks with e2e/integration tests | `npm test && DATABASE_HOST=localhost npm run test:e2e` |
| Build | Last task of a phase | `npm run lint && npm run typecheck && npm test && DATABASE_HOST=localhost npm run test:e2e && npm run build` |

---

## Execution Plan

### Phase 1: Owner-scoped data access

```
T1 -> T2
T2 -> T3
```

### Phase 2: Owner-scoped reads over HTTP

```
T4 -> T5
```

---

## Task Breakdown

### Phase 1: Owner-scoped data access

### T1: Declare the owner-scoped reads on the repository port and the in-memory adapter

**What**: Add `findPageByOwner`, `countByOwner` and `findByIdAndOwner` to the port and implement them in the in-memory repository with the design's filter and order.
**Where**: `src/domain/processing-request.repository.ts`
**Depends on**: None
**Reuses**: `InMemoryProcessingRequestRepository` storage map
**Requirement**: AUTH-10, AUTH-11, AUTH-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Every method takes the owner; no method lists without one
- [x] In-memory: filter by owner, order `createdAt` desc then `processingRequestId` asc, offset/limit applied after ordering, `countByOwner` counts only that owner, `findByIdAndOwner` returns `undefined` for another owner
- [x] Unit tests cover two owners, an empty owner, equal `createdAt` tiebreak, and a page beyond the end
- [x] Quick gate passes; test count grows by at least 6

**Tests**: unit
**Gate**: quick
**Status**: ✅ Complete. Quick gate green (unit 121 → 128). `tsc` stays red until T2 implements the port in the TypeORM adapter.

---

### T2: Implement the owner-scoped reads in the TypeORM repository

**What**: `find`/`count` with `where: { ownerUserId }` and the design's order; `findOne` with id and owner together.
**Where**: `src/infrastructure/persistence/typeorm-processing-request.repository.ts`
**Depends on**: T1
**Reuses**: `toDomain`, the injected `EntityManager`
**Requirement**: AUTH-10, AUTH-11, AUTH-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] No load-then-filter: the owner is in the query for all three methods
- [x] An e2e suite against PostgreSQL seeds two owners and asserts disjoint pages, the right `total`, the tiebreak on equal `createdAt`, offset beyond the end, and `findByIdAndOwner` returning nothing for the other owner
- [x] Full gate passes with `DATABASE_HOST` set and 0 skipped

**Tests**: integration
**Gate**: full
**Status**: ✅ Complete. Full gate green: unit 128, e2e 43 → 50, 0 skipped with `DATABASE_HOST`. `tsc` green again. `test/owner-scoped-reads.e2e-spec.ts` captures the SQL to prove the owner is in each query.

---

### T3: Add the composite owner index

**What**: Migration `1789955000000-IndexProcessingRequestOwnerCreatedAt` creating `idx_processing_request_owner_created (owner_user_id, created_at DESC, processing_request_id)` and dropping `idx_processing_request_owner`; `down()` reverses both.
**Where**: `src/infrastructure/persistence/migrations/1789955000000-IndexProcessingRequestOwnerCreatedAt.ts`
**Depends on**: T2
**Reuses**: The existing migration's `IF [NOT] EXISTS` style
**Requirement**: AUTH-10

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] After `runMigrations`, `pg_indexes` shows the new index and not the old one; after reverting it, the reverse
- [x] Running the migrations twice leaves nothing pending
- [x] Build gate passes

**Tests**: integration
**Gate**: build
**Status**: ✅ Complete. Build gate green: lint, typecheck, unit 128, e2e 50 → 53 with 0 skipped, build. `fiap-x-platform/db/create-database.sql` must be regenerated in the platform tasks.

---

### Phase 2: Owner-scoped reads over HTTP

### T4: Add the owned-item projection and the two queries

**What**: `toOwnedItem` (allow-list, `failureReasonFor` iff `FAILED`, ISO dates) and `ListOwnedProcessingRequestsQuery` / `GetOwnedProcessingRequestQuery` reading through the repository port.
**Where**: `src/application/owned-item.ts`
**Depends on**: None
**Reuses**: `failureReasonFor`, the repository port from T1
**Requirement**: AUTH-10, AUTH-12, AUTH-13

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Items carry exactly `processingRequestId`, `status`, `createdAt`, `updatedAt`, plus `failureReason` only for `FAILED`, with the exact sentence per code
- [ ] No item carries `sourceStorageKey`, `zipStorageKey`, `attemptId`, `failureCode` or `ownerUserId`
- [ ] The list query computes `offset = (page - 1) * pageSize` and returns `{ items, page, pageSize, total }`
- [ ] Quick gate passes; test count grows by at least 8

**Tests**: unit
**Gate**: quick

---

### T5: Serve the owned reads and register them in every mode

**What**: `OwnedProcessingRequestsController` with `GET /owners/:ownerUserId/processing-requests` and `GET /owners/:ownerUserId/processing-requests/:id`, registered in `app.module.ts` regardless of `LOCAL_INTEGRATION`.
**Where**: `src/interface/owned-processing-requests.controller.ts`
**Depends on**: T4
**Reuses**: `create-processing-request.controller.ts` validation style
**Requirement**: AUTH-10, AUTH-11, AUTH-12, AUTH-13

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Blank owner → 400; `page`/`pageSize` invalid → 400 naming the parameter and range; the repository is not queried in either case
- [ ] A non-UUID id → the constant 404 before any query; another owner's id and a random UUID → the same constant 404 body
- [ ] e2e against PostgreSQL: two owners' lists disjoint, ordered, `total` correct; defaults `page=1`, `pageSize=20`
- [ ] A composition e2e boots with `LOCAL_INTEGRATION` unset and asserts the owned routes answer while `GET /processing-requests/:id` (observation) is absent
- [ ] Build gate passes, 0 skipped

**Tests**: e2e
**Gate**: build

---

## Phase Execution Map

```
Phase 1 (T1 T2 T3) then Phase 2 (T4 T5)
```

5 tasks fit one batch: executed inline, followed by the Verifier. Cross-repository order for S5: this repository first, then `fiap-x-api`, then `fiap-x-platform` (whose smoke needs both, and whose database script is regenerated from T3's migration).

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: Port + in-memory reads | 1 port, its double | ⚠️ OK - cohesive; the double is how the port is tested |
| T2: TypeORM reads | 1 class | ✅ Granular |
| T3: Composite index | 1 migration | ✅ Granular |
| T4: Projection + two queries | 1 file of pure functions/queries | ⚠️ OK - cohesive; both queries share the projection |
| T5: Controller + registration | 1 controller + 1 line in the module | ✅ Granular (cohesive - unregistered, it is untestable) |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows (within phase) | Status |
| --- | --- | --- | --- |
| T1 | None | — | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | None | — | ✅ Match |
| T5 | T4 | T4 → T5 | ✅ Match |

No task depends on a later phase.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Repository port + in-memory adapter | unit | unit | ✅ OK |
| T2 | TypeORM repository | integration | integration | ✅ OK |
| T3 | Migration | integration | integration | ✅ OK |
| T4 | Application queries + projection | unit | unit | ✅ OK |
| T5 | Controller + module wiring | e2e | e2e | ✅ OK |
