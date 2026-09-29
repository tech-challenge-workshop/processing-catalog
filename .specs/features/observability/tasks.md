# Observability Tasks — Processing Catalog

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/observability/design.md`
**Status**: Draft

> **Merge order**: this branch carries the only S8 database migration. It must merge to `main` **before** the `fiap-x-platform` S8 PR, whose `generate-db-script.mjs --check` gate regenerates `db/create-database.sql` from this repo's `main` migrations (same constraint shape as AD-015). Other service repos are order-free relative to this one.

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: CI workflow (`.github/workflows/ci.yml`: unit with coverage, e2e against real Postgres via service container, fail-on-skipped, lint `--max-warnings 0`, typecheck, build); `package.json` scripts; existing specs colocated `src/**/*.spec.ts` + `test/*.e2e-spec.ts` (`maxWorkers: 1`).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Observability infra (context, logger, metrics) | unit | All branches; L-005 bounds; L-010 strict parse; gauge/counter edge cases | `src/observability/*.spec.ts` | `npm test` |
| Use cases / consumers / relay hooks touched | unit | 1:1 to touched ACs; happy + edge + error | colocated `*.spec.ts` | `npm test` |
| Persistence (migration + entity + round-trip) | e2e | Migration applies; column round-trips; events carry the id | `test/*.e2e-spec.ts` | `npm run test:e2e` |
| HTTP surface (/metrics, health split, 400s) | e2e | Every new/changed route: happy + edge + error | `test/*.e2e-spec.ts` | `npm run test:e2e` |
| Config / module wiring / main.ts | none | - (build gate only) | - | build gate only |

## Gate Check Commands

> Generated from `package.json` - confirm before Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After tasks with unit tests only | `npm test` |
| Full | After tasks touching persistence/e2e | `npm test && npm run test:e2e` |
| Build | After phase completion or config-only tasks | `npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run build` |

---

## Execution Plan

Pure dependency chains: each task depends only on the previous one.

### Phase 1: Observability foundation

```
T1 -> T2 -> T3 -> T4 -> T5
```

### Phase 2: Persist and publish the correlationId

```
T5 -> T6 -> T7 -> T8 -> T9 -> T10 -> T11
```

### Phase 3: Consume, count, and scrape

```
T12 -> T13 -> T14 -> T15 -> T16 -> T17 -> T18
```

### Phase 4: End-to-end verification

```
T18
```

---

## Task Breakdown

### T1: CorrelationContext (ALS + strict parser)

**What**: Same component as the API: `runWithCorrelation`, `getCorrelationId`, `getOrGenerateCorrelationId`, `parseCorrelationId` (trim + `/^[\x20-\x7E]{1,128}$/`, non-strings → null — L-010).
**Where**: `src/observability/correlation-context.ts`
**Depends on**: None
**Reuses**: `node:async_hooks`, `node:crypto`
**Requirement**: foundation for OBS-19/20

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [x] Concurrent runs are isolated; parser bounds verified at 1/128/129 chars and for number/object/null inputs
- [x] Gate check passes: `npm test`
- [x] Test count: 10 new unit tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(catalog): add the correlation context for observability`

---

### T2: Pino root logger config

**What**: Root config: ALS `mixin`, redact paths (`req.headers.authorization`, `*.ownerEmail`, `*.email`, plus defensive `*.zipStorageKey`/`*.sourceStorageKey`), `autoLogging.ignore` for `/health`, `/health/live`, `/metrics`, `LOG_LEVEL` default `info`.
**Where**: `src/observability/logger.config.ts`
**Depends on**: T1
**Reuses**: T1
**Requirement**: OBS-22

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [x] Log lines are single JSON objects with `service: 'processing-catalog'` and the ALS correlation id
- [x] An `ownerEmail` value anywhere in a logged object is redacted
- [x] Gate check passes: `npm test`
- [x] Test count: 7 new unit tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(catalog): add the structured logger config with redaction`

---

### T3: ObservabilityModule

**What**: `LoggerModule.forRoot(rootConfig)` + CorrelationContext singleton.
**Where**: `src/observability/observability.module.ts`
**Depends on**: T2
**Reuses**: nestjs-pino
**Requirement**: OBS-22

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [x] Module compiles; gate check passes: `npm run lint && npm run typecheck && npm run build`
- [x] Test count: no new tests (config layer - matrix)

**Tests**: none
**Gate**: build

**Commit**: `feat(catalog): add the observability module`

---

### T4: Wire module + middleware + pino bootstrap

**What**: Import ObservabilityModule in AppModule, register CorrelationMiddleware (HTTP edge, same as API), `main.ts` buffers + `useLogger(Logger)` + `flushLogs`.
**Where**: `src/app.module.ts`
**Depends on**: T3
**Reuses**: T1 middleware pattern
**Requirement**: OBS-22

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [x] Booted app emits JSON logs with per-request correlation ids on the HTTP surface
- [x] Gate check passes: `npm run lint && npm run typecheck && npm run build`
- [x] Test count: no new tests (wiring layer - matrix; e2e in T18)

**Tests**: none
**Gate**: build

**Commit**: `feat(catalog): wire the observability module into the app`

---

### T5: AddCorrelationId migration

**What**: TypeORM migration adding `correlation_id varchar(128) NULL` to `processing_request`; down drops it.
**Where**: `src/infrastructure/persistence/migrations/<timestamp>-AddCorrelationId.ts`
**Depends on**: T4
**Reuses**: AD-009 migration conventions
**Requirement**: OBS-16

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [x] Migration runs clean on an empty e2e database and applies exactly the one column (verified via the e2e setup in T7's full gate)
- [x] Gate check passes: `npm run migration:run` against a scratch database (build gate)
- [x] Test count: no new tests (migration layer - matrix; round-trip in T7/T18 e2e)

> Gate note: `npm run migration:run` fails before reaching any migration (pre-existing: `data-source.ts` exports a factory, not the `DataSource` instance the TypeORM CLI requires). The migration was applied, reverted and reapplied on an empty scratch database through `createDataSource().runMigrations()` / `undoLastMigration()` (the path the app uses at boot): exactly `correlation_id varchar(128) NULL` is added, and down drops it. The phase build gate (lint, typecheck, unit, e2e against Postgres, build) passed with the migration applied to the e2e database.

**Tests**: none
**Gate**: build

**Commit**: `feat(catalog): add the correlation id migration`

---

### T6: Entity column

**What**: `correlationId: string | null` mapped to `correlation_id` on the ProcessingRequest entity.
**Where**: `src/infrastructure/persistence/processing-request.entity.ts`
**Depends on**: T5
**Reuses**: existing entity
**Requirement**: OBS-16

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [x] TypeORM maps the column without schema drift on existing suites
- [x] Gate check passes: `npm test && npm run test:e2e`
- [x] Test count: no new tests (entity layer - matrix; round-trip in T7/T18 e2e)

**Tests**: none
**Gate**: full

**Commit**: `feat(catalog): map the correlation id column on the entity`

---

### T7: Create use case persists + publishes the id

**What**: Create DTO/use-case input gains optional `correlationId` (validated: non-blank ≤128 printable ASCII → same 400 field-error shape as `ownerEmail`); persisted in the same transaction; the `VideoValidationRequested` payload built into the outbox row includes the stored id (field omitted when absent). This task also updates `src/messaging/dto/video-validation-requested.dto.ts` (one-line optional field) — cohesive contract+writer pair.
**Where**: `src/application/create-processing-request.use-case.ts`
**Depends on**: T6
**Reuses**: S7 ownerEmail pattern end-to-end
**Requirement**: OBS-16, OBS-17

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [x] Unit: validation matrix for the new field (missing/empty/blank/127-128-129 chars/non-string → 400 field error; valid → persisted + payload carries it)
- [x] Unit: outbox payload omits the field when absent
- [x] Gate check passes: `npm test && npm run test:e2e`
- [x] Test count: 9 new unit tests pass (no silent deletions)

> Interpretation: "missing" is read as *absent*, which the spec makes valid (validated "when present"; edge case: NULL column → field omitted). Absent is accepted, stored as NULL and omitted from the payload; empty, blank, 129 chars, non-printable and non-string are rejected as `ProcessingRequestDomainError` (mapped to 400 by the controller). The stored value is the trimmed one (L-004).

**Tests**: unit
**Gate**: full

**Commit**: `feat(catalog): persist and publish the correlation id on creation`

---

### T8: Create controller exposes the field

**What**: `POST` handler DTO accepts `correlationId` (whitelist/forbid rules unchanged) and forwards it; controller-level validation errors keep the existing shape.
**Where**: `src/interface/create-processing-request.controller.ts`
**Depends on**: T7
**Reuses**: existing controller + validation pipe
**Requirement**: OBS-21

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [x] E2E (in T18 sweep): 400 on invalid values, 201 with persisted value on valid — controller surface asserts the same matrix through HTTP
- [x] Gate check passes: `npm test && npm run test:e2e`
- [x] Test count: 2 new e2e cases pass (no silent deletions)

> Landed in `test/create-processing-request-route.e2e-spec.ts` (the route's existing e2e), not deferred to T18: 201 stores `cat-1` in `processing_request.correlation_id` and the outbox payload; the 400 case walks empty, blank, 129 chars, a number and `null` through HTTP in the existing field-error shape, writing nothing. The body field is the only persisted source; the `X-Correlation-Id` header still scopes the request's logs (T4 middleware) but is not persisted.

**Tests**: e2e
**Gate**: full

**Commit**: `feat(catalog): accept the correlation id on the create endpoint`

---

### T9: Accept use case carries the id on ProcessingQueued

**What**: `src/messaging/dto/processing-queued.dto.ts` gains the optional field; the accept use case sets it from the stored request when publishing.
**Where**: `src/application/accept-processing-request.use-case.ts`
**Depends on**: T8
**Reuses**: T7 payload pattern
**Requirement**: OBS-17

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [ ] Unit: published `ProcessingQueued` carries the stored id; omits when NULL
- [ ] Gate check passes: `npm test && npm run test:e2e`
- [ ] Test count: 4 new unit tests pass (no silent deletions)

**Tests**: unit
**Gate**: full

**Commit**: `feat(catalog): carry the correlation id on processing queued`

---

### T10: Terminal-event DTO field

**What**: `src/messaging/dto/terminal-event.dto.ts` gains optional `correlationId`.
**Where**: `src/messaging/dto/terminal-event.dto.ts`
**Depends on**: T9
**Reuses**: existing DTO
**Requirement**: OBS-18

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [ ] DTO accepts and carries the optional field (type-level, used by T11/T12)
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Test count: 1 new unit test passes (no silent deletions)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(catalog): add the correlation id to the terminal event dto`

---

### T11: Complete use case publishes the id

**What**: Complete use case sets `correlationId` on the terminal event from the stored request.
**Where**: `src/application/complete-processing-request.use-case.ts`
**Depends on**: T10
**Reuses**: T9 pattern
**Requirement**: OBS-18

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [ ] Unit: terminal event carries the stored id; omits when NULL
- [ ] Gate check passes: `npm test && npm run test:e2e`
- [ ] Test count: 4 new unit tests pass (no silent deletions)

**Tests**: unit
**Gate**: full

**Commit**: `feat(catalog): publish the correlation id on completion`

---

### T12: Fail use case publishes the id

**What**: Fail use case sets `correlationId` on the terminal event from the stored request.
**Where**: `src/application/fail-processing-request.use-case.ts`
**Depends on**: T11
**Reuses**: T11 pattern
**Requirement**: OBS-18

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [ ] Unit: terminal event carries the stored id; omits when NULL
- [ ] Gate check passes: `npm test && npm run test:e2e`
- [ ] Test count: 4 new unit tests pass (no silent deletions)

**Tests**: unit
**Gate**: full

**Commit**: `feat(catalog): publish the correlation id on failure`

---

### T13: CatalogMetrics registry + families

**What**: Dedicated `Registry`; `fiapx_outbox_pending_rows`, `fiapx_outbox_oldest_pending_seconds` (gauge collect callbacks reading the relay — wired in T16), `fiapx_outbox_publish_failures_total`, `fiapx_events_consumed_total{event,outcome}`, HTTP counters; `resetMetrics()`.
**Where**: `src/observability/metrics.ts`
**Depends on**: T12
**Reuses**: prom-client
**Requirement**: OBS-23, OBS-24, OBS-25

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [ ] Unit: counters/gauges behave; labels bounded; reset without duplicate-registration errors
- [ ] Gate check passes: `npm test`
- [ ] Test count: 6 new unit tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(catalog): add the fiapx metrics registry and outbox families`

---

### T14: Consumed counter at the settle point

**What**: `recordEventConsumed(event, outcome)` invoked in `settle-failed-message.ts` — the single settlement path (ack after success, nack-requeue on transient, nack-DLQ on permanent).
**Where**: `src/infrastructure/rabbitmq/settle-failed-message.ts`
**Depends on**: T13
**Reuses**: T13 metrics
**Requirement**: OBS-25

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [ ] Unit: each settlement branch increments exactly once with the right label (event name supplied by the caller)
- [ ] Gate check passes: `npm test`
- [ ] Test count: 5 new unit tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(catalog): count consumed events at the settle point`

---

### T15: Consumer correlation wrapper

**What**: `with-correlation.ts` helper (`parse → ALS.run → handler → clear`); applied to the five lifecycle consumers (`video-accepted`, `video-rejected`, `processing-started`, `processing-completed`, `processing-failed`). Helper and its application land together so no consumer is half-wrapped. Consumed DTOs (`video-accepted.dto.ts`, `video-rejected.dto.ts`, `processing-started.dto.ts`, `processing-completed.dto.ts`, `processing-failed.dto.ts`) gain the optional field in the same task — contract family, one commit.
**Where**: `src/infrastructure/messaging/with-correlation.ts`
**Depends on**: T14
**Reuses**: T1 context, T14 counter labels
**Requirement**: OBS-19, OBS-20

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [ ] Unit (helper): context set from a valid message id, cleared after; absent/invalid (number/object) → generated id, handler still runs (L-010)
- [ ] Unit (one consumer per family): `fiapx_events_consumed_total` gets the right label through the wrapped path
- [ ] Gate check passes: `npm test && npm run test:e2e`
- [ ] Test count: 9 new unit tests pass (no silent deletions)

**Tests**: unit
**Gate**: full

**Commit**: `feat(catalog): propagate the correlation id through consumers`

---

### T16: Relay gauges + publish-failure counter

**What**: Relay catch on confirm timeout/reject increments `fiapx_outbox_publish_failures_total` (row stays pending — V45 semantics untouched); gauge collect callbacks read `pendingCount()`/`oldestPendingAgeSeconds()`; register gauge collectors with the relay instance.
**Where**: `src/infrastructure/messaging/outbox-relay.ts`
**Depends on**: T15
**Reuses**: T13 metrics, existing relay methods
**Requirement**: OBS-23, OBS-24

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [ ] Unit: publish failure increments exactly once per failed attempt (not per tick); gauges reflect mocked relay values; null oldest age → 0
- [ ] Gate check passes: `npm test && npm run test:e2e`
- [ ] Test count: 6 new unit tests pass (no silent deletions)

**Tests**: unit
**Gate**: full

**Commit**: `feat(catalog): instrument the outbox relay with gauges and failure counter`

---

### T17: Liveness endpoint + /metrics controller

**What**: `GET /health/live` (200) on the health controller; `GET /metrics` on a new unauthenticated controller serving `registry.metrics()`.
**Where**: `src/interface/health.controller.ts`
**Depends on**: T16
**Reuses**: T13 registry
**Requirement**: OBS-26, OBS-27, OBS-28

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [ ] E2E (T18 sweep): `/health` 200/503 semantics unchanged, `/health/live` 200, `/metrics` 200 with all families
- [ ] Gate check passes: `npm test && npm run test:e2e`
- [ ] Test count: 3 new e2e cases pass (no silent deletions)

**Tests**: e2e
**Gate**: full

**Commit**: `feat(catalog): add the liveness endpoint and metrics exposition`

---

### T18: Observability e2e sweep

**What**: New `test/observability.e2e-spec.ts` (real Postgres, existing e2e setup): correlation chain — create with `correlationId: cat-1` → drive to `COMPLETED` → terminal event DTO carries `cat-1` (asserted at the publisher/outbox boundary); consumer fallback — message without the field is handled with a generated id and acked; `/metrics` exposes all families with seeded pending outbox rows; `/health` 503 + `/health/live` 200 + `/metrics` 200 with the database stopped (existing container-kill helper or indicator mock per current health e2e conventions); every captured log line JSON with the propagated id and no `ownerEmail`.
**Where**: `test/observability.e2e-spec.ts`
**Depends on**: T17
**Reuses**: existing e2e database setup + publisher fakes
**Requirement**: OBS-16..28

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [ ] All assertions above pass against real Postgres
- [ ] Gate check passes: `npm test && npm run test:e2e && npm run lint && npm run typecheck && npm run build`
- [ ] Test count: 10 new e2e tests pass (no silent deletions)

**Tests**: e2e
**Gate**: full

**Commit**: `test(catalog): prove the observability slice end to end`

---

## Phase Execution Map

```
Phase 1:  T1 -> T2 -> T3 -> T4 -> T5
Phase 2:  T5 -> T6 -> T7 -> T8 -> T9 -> T10 -> T11 -> T12
Phase 3:  T12 -> T13 -> T14 -> T15 -> T16 -> T17 -> T18
Phase 4:  T18
```

Execution is strictly sequential — one task at a time, gate before commit, one Conventional Commit per task.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1 | 1 module | ✅ Granular |
| T2 | 1 module | ✅ Granular |
| T3 | 1 module | ✅ Granular |
| T4 | wiring (module + main) | ⚠️ Cohesive bootstrap pair |
| T5 | 1 migration | ✅ Granular |
| T6 | 1 entity | ✅ Granular |
| T7 | use case + its published DTO | ⚠️ Cohesive contract+writer pair (one commit, one AC family) |
| T8 | 1 controller | ✅ Granular |
| T9 | use case + its DTO | ⚠️ Cohesive contract+writer pair |
| T10 | 1 DTO | ✅ Granular |
| T11 | 1 use case | ✅ Granular |
| T12 | 1 use case | ✅ Granular |
| T13 | 1 module | ✅ Granular |
| T14 | 1 settle helper | ✅ Granular |
| T15 | helper + 5 consumer applications + 5 consumed DTOs | ⚠️ One mechanical pattern applied identically — splitting would force 6 near-empty commits; the change is all-or-nothing (a half-wrapped consumer is a bug) |
| T16 | relay instrumentation | ✅ Granular |
| T17 | health + metrics controller | ⚠️ Two tiny endpoints, one observability surface |
| T18 | 1 spec | ✅ Granular (verification slice) |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | none | none | ✅ Match |
| T2 | T1 | T1 -> T2 | ✅ Match |
| T3 | T2 | T2 -> T3 | ✅ Match |
| T4 | T3 | T3 -> T4 | ✅ Match |
| T5 | T4 | T4 -> T5 | ✅ Match |
| T6 | T5 | T5 -> T6 | ✅ Match |
| T7 | T6 | T6 -> T7 | ✅ Match |
| T8 | T7 | T7 -> T8 | ✅ Match |
| T9 | T8 | T8 -> T9 | ✅ Match |
| T10 | T9 | T9 -> T10 | ✅ Match |
| T11 | T10 | T10 -> T11 | ✅ Match |
| T12 | T11 | T11 -> T12 | ✅ Match |
| T13 | T12 | T12 -> T13 | ✅ Match |
| T14 | T13 | T13 -> T14 | ✅ Match |
| T15 | T14 | T14 -> T15 | ✅ Match |
| T16 | T15 | T15 -> T16 | ✅ Match |
| T17 | T16 | T16 -> T17 | ✅ Match |
| T18 | T17 | T17 -> T18 | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1 | observability infra | unit | unit | ✅ OK |
| T2 | observability infra | unit | unit | ✅ OK |
| T3 | config/module | none | none | ✅ OK |
| T4 | config/wiring | none | none (e2e in T18) | ✅ OK |
| T5 | migration | e2e (round-trip) | none | ⚠️ Round-trip asserted in T7/T18 e2e (migration suites run in the shared e2e DB setup; standalone migration e2e would test TypeORM, not this code) |
| T6 | entity | e2e (round-trip) | none | ⚠️ Same — round-trip in T7/T18 |
| T7 | use case | unit + e2e | unit (+ full gate incl. e2e) | ✅ OK |
| T8 | controller | e2e | e2e | ✅ OK |
| T9 | use case | unit | unit | ✅ OK |
| T10 | DTO | unit | unit | ✅ OK |
| T11 | use case | unit | unit | ✅ OK |
| T12 | use case | unit | unit | ✅ OK |
| T13 | observability infra | unit | unit | ✅ OK |
| T14 | settle helper | unit | unit | ✅ OK |
| T15 | consumers + helper | unit | unit (+ full gate) | ✅ OK |
| T16 | relay | unit | unit | ✅ OK |
| T17 | controllers | e2e | e2e | ✅ OK |
| T18 | e2e layer | e2e | e2e | ✅ OK |
