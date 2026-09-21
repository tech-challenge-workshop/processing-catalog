# Durable Persistence Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/durable-persistence/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `.specs/features/full-lifecycle/tasks.md` (prior matrix for this repository), `test/jest-e2e.json`, `package.json` scripts. No coverage threshold is configured anywhere in the repository.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Domain aggregate | unit | Unchanged by this slice; existing coverage must not regress | `src/domain/*.spec.ts` | `npm test` |
| Application use cases | unit | Happy path, duplicate `eventId`, forbidden transition, unknown request, and that an outbox row is written instead of a direct publication | `src/application/*.spec.ts` | `npm test` |
| Persistence adapters | integration | Every port method against a real PostgreSQL, plus atomicity: a failure inside the transaction leaves no row in any of the three tables | `test/*.integration-spec.ts` | `npm run test:e2e` |
| Outbox relay | unit + integration | Unit: publishes pending, marks sent only after confirm, skips when empty. Integration: a broker outage leaves rows pending and drains them on return | `src/infrastructure/messaging/*.spec.ts`, `test/*.integration-spec.ts` | `npm test`, `npm run test:e2e` |
| Migrations | integration | Applied to an empty database, twice, with the second run a no-op | `test/*.integration-spec.ts` | `npm run test:e2e` |
| Entities and config | none | Build gate only - they declare shape and carry no behaviour | `src/infrastructure/persistence/*.entity.ts` | build gate only |

**Atomicity is asserted only at the integration layer.** `InMemoryUnitOfWork` cannot roll back, so a unit test claiming atomicity would pass without proving anything. Do not write one.

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | After tasks with unit tests only | `npm test` |
| Full | After tasks touching persistence or the relay | `npm test && npm run test:e2e` |
| Build | After phase completion | `npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run build` |

**Note**: integration tests need PostgreSQL and RabbitMQ. Start both first: `docker compose -f ../fiap-x-platform/compose.yaml up -d postgres rabbitmq`.

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

**Phase 1 is mechanical and wide.** The port becomes asynchronous first so the compiler enumerates every call site, rather than discovering them while also introducing PostgreSQL.

### Phase 1: An asynchronous port

```
T1 → T2 → T3 → T4
```

### Phase 2: PostgreSQL behind the port

```
T5 → T6 → T7 → T8
```

### Phase 3: The transactional outbox

```
T9 → T10 → T11 → T12 → T13
```

### Phase 4: Resilience and the deliverable

```
T14 → T15 → T16
```

---

## Task Breakdown

### T1: Make the repository port asynchronous

**What**: Change all six methods of `ProcessingRequestRepository` to return promises.
**Where**: `src/domain/processing-request.repository.ts`
**Depends on**: None
**Reuses**: The existing method names and arguments, which do not change
**Requirement**: DP-01, DP-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Every method returns a promise; no name or argument changes
- [ ] `npm run typecheck` lists every call site that now needs an `await`, and that list is recorded in the task notes
- [ ] Quick gate passes after T2 and T3 land; this task alone is expected to leave the tree uncompilable

**Tests**: none
**Gate**: quick

---

### T2: Make the in-memory adapter asynchronous

**What**: Return resolved promises from the in-memory repository, keeping its behaviour identical.
**Where**: `src/infrastructure/in-memory-processing-request.repository.ts`
**Depends on**: T1
**Reuses**: The existing Map-backed implementation
**Requirement**: DP-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Every method satisfies the new port
- [ ] Its existing unit tests pass with `await`, none weakened
- [ ] Quick gate passes: `npm test`

**Tests**: unit
**Gate**: quick

---

### T3: Await the port in the use cases

**What**: Add `await` at every repository call in the five use cases.
**Where**: `src/application/`
**Depends on**: T2
**Reuses**: The existing eight-step use-case bodies, otherwise unchanged
**Requirement**: DP-01, DP-02, DP-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `npm run typecheck` reports zero errors, which is what proves no call site was missed
- [ ] No use case's behaviour changed: every existing assertion passes untouched
- [ ] A test asserts a repository result is compared by value and not against a pending promise
- [ ] Quick gate passes: `npm test`

**Tests**: unit
**Gate**: quick

---

### T4: Await the port in the observation controller

**What**: Make the local observation route await its lookup.
**Where**: `src/interface/processing-request-observation.controller.ts`
**Depends on**: T3
**Reuses**: The existing route and its `LOCAL_INTEGRATION` guard
**Requirement**: DP-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] The route returns the request, not a promise, asserted by reading a field from the response body
- [ ] The route still returns 404 for an unknown id and is still absent without the flag
- [ ] Build gate passes

**Tests**: e2e
**Gate**: build

---

### T5: Add the data source and its configuration

**What**: Add TypeORM, a data source reading connection settings from the environment, and register it in the module.
**Where**: `src/infrastructure/persistence/data-source.ts`
**Depends on**: T4
**Reuses**: The environment-variable convention already used for `RABBITMQ_URL`
**Requirement**: DP-01, DP-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Connection settings come from the environment with no credential in the repository
- [ ] `synchronize` is off, so migrations are the only way the schema changes
- [ ] The application still boots with the in-memory adapter when no database is configured
- [ ] Quick gate passes: `npm test`

**Tests**: none
**Gate**: quick

---

### T6: Add the request entity and its migration

**What**: Map `ProcessingRequest` onto `processing_request`, and add the migration that creates it and `processed_event`.
**Where**: `src/infrastructure/persistence/processing-request.entity.ts`
**Depends on**: T5
**Reuses**: The aggregate shape settled in S2, including `failureCode`
**Requirement**: DP-02, DP-05, DP-14, DP-16

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `processed_event.event_id` is the primary key, so deduplication is a schema guarantee
- [ ] `attempt_id`, `zip_storage_key` and `failure_code` are nullable and persist as absent rather than as empty strings
- [ ] No column stores binary content
- [ ] Applying the migration twice makes no change on the second run
- [ ] Full gate passes

**Tests**: integration
**Gate**: full

---

### T7: Implement the repository against PostgreSQL

**What**: Add the TypeORM adapter satisfying the port.
**Where**: `src/infrastructure/persistence/typeorm-processing-request.repository.ts`
**Depends on**: T6
**Reuses**: The in-memory adapter's behaviour as the specification of what this must do
**Requirement**: DP-01, DP-02, DP-03, DP-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Every port method is exercised against a real PostgreSQL
- [ ] A request written, then read after the connection is re-established, returns every field by value
- [ ] A duplicate `event_id` is rejected by the primary key rather than creating a second row
- [ ] Full gate passes

**Tests**: integration
**Gate**: full

---

### T8: Report the database in readiness

**What**: Add a database health indicator and include it in the health endpoint.
**Where**: `src/infrastructure/persistence/database.health-indicator.ts`
**Depends on**: T7
**Reuses**: `rabbitmq.health-indicator.ts` as the template
**Requirement**: DP-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Readiness is false when the database is unreachable and true when it is up
- [ ] Liveness stays healthy while the database is down
- [ ] Build gate passes

**Tests**: unit
**Gate**: build

---

### T9: Declare the unit of work and its in-memory implementation

**What**: Add the `UnitOfWork` port whose context carries a scoped repository and outbox writer, plus the in-memory implementation.
**Where**: `src/application/unit-of-work.ts`
**Depends on**: T8
**Reuses**: The repository port from T1
**Requirement**: DP-07, DP-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] The work receives its repository through the context, so no unscoped repository is reachable inside the callback
- [ ] The in-memory implementation documents in a comment that it cannot roll back
- [ ] No unit test asserts atomicity through it
- [ ] Quick gate passes: `npm test`

**Tests**: unit
**Gate**: quick

---

### T10: Add the outbox table and its migration

**What**: Add the outbox entity and the migration creating it with a partial index on pending rows.
**Where**: `src/infrastructure/persistence/outbox.entity.ts`
**Depends on**: T9
**Reuses**: The migration convention from T6
**Requirement**: DP-07, DP-13, DP-14

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `published_at` null is the definition of pending, and is indexed
- [ ] The payload column holds the event as JSON
- [ ] Applying the migration twice makes no change on the second run
- [ ] Full gate passes

**Tests**: integration
**Gate**: full

---

### T11: Implement the transactional unit of work

**What**: Add the TypeORM implementation committing on resolve and rolling back on throw.
**Where**: `src/infrastructure/persistence/typeorm-unit-of-work.ts`
**Depends on**: T10
**Reuses**: TypeORM's transaction manager
**Requirement**: DP-07, DP-08

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A failure thrown inside the work leaves no row in `processing_request`, `processed_event` or `outbox`
- [ ] A successful work commits all three together
- [ ] The scoped repository writes through the transaction, proven by reading nothing from outside it before commit
- [ ] Full gate passes

**Tests**: integration
**Gate**: full

---

### T12: Write to the outbox instead of publishing

**What**: Change the use cases to record their event in the outbox inside the transaction, and stop calling the publisher.
**Where**: `src/application/`
**Depends on**: T11
**Reuses**: The use-case bodies from S2, with steps 2 to 6 moved inside the transaction callback
**Requirement**: DP-07, DP-08, DP-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] No use case calls the event publisher directly
- [ ] Each use case that produced an event now produces a pending outbox row carrying the same queue, pattern and payload
- [ ] Existing assertions about published events become assertions about the outbox row, with the payload still asserted field by field
- [ ] A forbidden transition writes no outbox row
- [ ] Full gate passes

**Tests**: unit
**Gate**: full

---

### T13: Publish pending rows from the relay

**What**: Add the relay that polls pending rows, publishes them, and marks them sent after the broker confirms.
**Where**: `src/infrastructure/messaging/outbox-relay.ts`
**Depends on**: T12
**Reuses**: `sendToQueue` on the existing `RabbitMQConnection`
**Requirement**: DP-10, DP-11, DP-12, DP-13

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A pending row is published and then marked sent, in that order, asserted by sequence and not only by outcome
- [ ] A broker failure leaves the row pending and publishes it on a later poll
- [ ] A crash simulated between publishing and marking sent results in a second publication, and the consumer's deduplication absorbs it
- [ ] An empty outbox produces no publication and no log line
- [ ] The pending count and the age of the oldest row are exposed
- [ ] Build gate passes

**Tests**: unit
**Gate**: build

---

### T14: Dead-letter what keeps failing

**What**: Declare each consumed queue with dead-letter arguments so a message that keeps failing leaves the main queue.
**Where**: `src/infrastructure/rabbitmq/rabbitmq.connection.ts`
**Depends on**: T13
**Reuses**: The existing `RABBITMQ_QUEUES` assertion, already guarded by `queue-declaration.spec.ts`
**Requirement**: DP-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Every consumed queue declares a dead-letter target
- [ ] A message failing beyond the limit lands there and stops blocking its queue
- [ ] `queue-declaration.spec.ts` still passes, and covers the dead-letter queues too
- [ ] Full gate passes

**Tests**: integration
**Gate**: full

---

### T15: Prove durability and atomicity end to end

**What**: Add the integration suite covering restart survival, replay, and a broker outage.
**Where**: `test/durable-persistence.integration-spec.ts`
**Depends on**: T14
**Reuses**: The lifecycle sequences from the S2 e2e suite
**Requirement**: DP-03, DP-04, DP-11, DP-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A request driven to `PROCESSING`, then read through a new data source, still holds its status and attempt
- [ ] Replaying every event after that applies no transition and writes no outbox row
- [ ] With the broker stopped, transitions commit and rows stay pending; when it returns, every event arrives once as observed by the consumer
- [ ] A failure mid-transaction leaves none of the three tables written
- [ ] Build gate passes

**Tests**: integration
**Gate**: build

---

### T16: Ship the schema

**What**: Document how migrations are applied and confirm they produce the schema the platform's generator reads.
**Where**: `README.md`
**Depends on**: T15
**Reuses**: The migrations from T6 and T10
**Requirement**: DP-14, DP-15, DP-16

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Applying the migrations to an empty database creates every table with no manual step
- [ ] Applying them twice makes no change on the second run
- [ ] The README states the command, and states that the creation deliverable is generated in `fiap-x-platform`, not maintained here
- [ ] Build gate passes

**Tests**: integration
**Gate**: build

**Commit**: `feat(persistence): make the catalog durable`

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4

Phase 1:  T1 ------→ T2 ------→ T3 ------→ T4
Phase 2:  T5 ------→ T6 ------→ T7 ------→ T8
Phase 3:  T9 ------→ T10 ------→ T11 ------→ T12 ------→ T13
Phase 4:  T14 ------→ T15 ------→ T16

Phase boundaries (the last task of a phase gates the first task of the next):
          T4 ------→ T5
          T8 ------→ T9
          T13 ------→ T14
```

Total: 16 tasks. This packs into three batches at the ~7-task worker budget: Phases 1-2 (8 tasks), Phase 3 (5 tasks) and Phase 4 (3 tasks). Execute should offer batch sub-agents.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: Port asynchronous | 1 interface | ✅ Granular |
| T2: In-memory adapter | 1 class | ✅ Granular |
| T3: Await in the use cases | 1 directory, one mechanical change | ⚠️ Wide but cohesive |
| T4: Await in the controller | 1 class | ✅ Granular |
| T5: Data source | 1 file | ✅ Granular |
| T6: Entity and migration | 1 entity + its migration | ✅ Granular |
| T7: PostgreSQL repository | 1 class | ✅ Granular |
| T8: Health indicator | 1 class | ✅ Granular |
| T9: Unit of work port | 1 port + its in-memory pair | ✅ Granular |
| T10: Outbox table | 1 entity + its migration | ✅ Granular |
| T11: Transactional unit of work | 1 class | ✅ Granular |
| T12: Use cases write to the outbox | 1 directory, one cohesive change | ⚠️ Wide but cohesive |
| T13: Relay | 1 class | ✅ Granular |
| T14: Dead-lettering | 1 file | ✅ Granular |
| T15: Integration suite | 1 suite | ✅ Granular |
| T16: Schema documentation | 1 file | ✅ Granular |

T3 and T12 each name a directory rather than a file. Both are single changes the compiler drives across the same five use cases, and splitting either into five tasks would produce five commits that do not compile alone. They are marked wide deliberately rather than passed off as granular.

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | no inbound arrow | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | T3 | T3 → T4 | ✅ Match |
| T5 | T4 | T4 → T5 (phase boundary) | ✅ Match |
| T6 | T5 | T5 → T6 | ✅ Match |
| T7 | T6 | T6 → T7 | ✅ Match |
| T8 | T7 | T7 → T8 | ✅ Match |
| T9 | T8 | T8 → T9 (phase boundary) | ✅ Match |
| T10 | T9 | T9 → T10 | ✅ Match |
| T11 | T10 | T10 → T11 | ✅ Match |
| T12 | T11 | T11 → T12 | ✅ Match |
| T13 | T12 | T12 → T13 | ✅ Match |
| T14 | T13 | T13 → T14 (phase boundary) | ✅ Match |
| T15 | T14 | T14 → T15 | ✅ Match |
| T16 | T15 | T15 → T16 | ✅ Match |

No task depends on a task in a later phase.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Repository port declaration | none | none | ✅ OK |
| T2 | In-memory adapter | unit | unit | ✅ OK |
| T3 | Application use cases | unit | unit | ✅ OK |
| T4 | Interface controller | e2e | e2e | ✅ OK |
| T5 | Config | none | none | ✅ OK |
| T6 | Entity + migration | integration | integration | ✅ OK |
| T7 | Persistence adapter | integration | integration | ✅ OK |
| T8 | Health indicator | unit | unit | ✅ OK |
| T9 | Application port + in-memory pair | unit | unit | ✅ OK |
| T10 | Entity + migration | integration | integration | ✅ OK |
| T11 | Persistence adapter | integration | integration | ✅ OK |
| T12 | Application use cases | unit | unit | ✅ OK |
| T13 | Outbox relay | unit | unit | ✅ OK |
| T14 | Queue declaration | integration | integration | ✅ OK |
| T15 | Durability end to end | integration | integration | ✅ OK |
| T16 | Migrations | integration | integration | ✅ OK |

T1 and T5 are the only `Tests: none`, matching the matrix for a declaration and for configuration. T1 is proven by T2 and T3, which cannot compile unless the port is right; T5 by T7, which cannot reach a database without it.
