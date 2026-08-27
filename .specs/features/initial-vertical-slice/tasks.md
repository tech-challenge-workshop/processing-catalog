# Catalog Initial Vertical Slice Tasks

## Execution Protocol

Implement these tasks with the `tlc-spec-driven` skill and its Execute flow. All code changes stay inside the `processing-catalog` repository. Each task must leave the existing NestJS quality gates green: `npm test`, `npm run lint`, and `npm run build`. No production PostgreSQL, migrations, transactional outbox, or RabbitMQ broker is introduced in this slice.

**Design**: `.specs/features/initial-vertical-slice/design.md`
**Status**: In Progress

## Test Coverage Matrix

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Domain aggregate | unit | State machine, valid creation, and required-field validation. | `src/domain/*.spec.ts` | `npm test` |
| Application use case | unit | Happy path, duplicate `eventId` idempotency, and missing-field rejection. | `src/application/*.spec.ts` | `npm test` |
| Interface controller | integration/e2e | Request creation endpoint returns the expected response and event JSON. | `test/*.e2e-spec.ts` | `npm test` |
| Lint/format | static | No errors or warnings after fixes. | `src/**/*.ts`, `test/**/*.ts` | `npm run lint` |
| Build | compilation | `dist/` is produced without TypeScript errors. | `src/**/*.ts` | `npm run build` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | After any TypeScript change | `npm run lint` |
| Full | After completing a task with logic | `npm test` |
| Build | Before marking the feature done | `npm run build` |

## Execution Plan

```
Phase 1: Domain model → Phase 2: Application behavior → Phase 3: Interface wiring → Phase 4: Tests and gates
P1 → P2 → P3 → P4
```

## Task Breakdown

### Phase 1: Domain model

```
T1 → T2
```

#### T1: Create ProcessingRequest aggregate

**What**: Implement the `ProcessingRequest` aggregate with `RECEIVED` as the initial state, required fields, and validation of allowed transitions.

**Where**: `src/domain/processing-request.ts`

**Depends on**: None

**Reuses**: `docs/foudation.md`, `docs/service-boundary.md`

**Requirement**: CAT-01, CAT-04

**Tools**:

- Skill: `tlc-spec-driven`

**Done when**:

- [ ] The aggregate exposes a factory that requires `ownerUserId` and `sourceStorageKey`.
- [ ] The initial status is always `RECEIVED`.
- [ ] Invalid transitions and missing fields are rejected with a domain error.

**Tests**: unit
**Gate**: full
**Status**: Complete

---

#### T2: Create repository interface and in-memory implementation

**What**: Define the repository port and an in-memory adapter that stores `ProcessingRequest` by `processingRequestId` and tracks processed `eventId` values.

**Where**: `src/infrastructure/in-memory-processing-request.repository.ts`

**Depends on**: T1

**Reuses**: `src/domain/processing-request.ts`

**Requirement**: CAT-01, CAT-03

**Tools**:

- Skill: `tlc-spec-driven`

**Done when**:

- [ ] The port allows saving a request and finding by `processingRequestId` and `eventId`.
- [ ] The in-memory adapter deduplicates by `eventId`.
- [ ] Unit tests prove save/find and duplicate detection.

**Tests**: unit
**Gate**: full
**Status**: Complete

---

### Phase 2: Application behavior

```
T4 → T3
```

#### T4: Create event publisher interface and in-memory publisher

**What**: Define the event publisher port and an in-memory adapter that records published JSON payloads for verification.

**Where**: `src/infrastructure/in-memory-event-publisher.ts`

**Depends on**: None

**Reuses**: `docs/foudation.md`

**Requirement**: CAT-02

**Tools**:

- Skill: `tlc-spec-driven`

**Done when**:

- [ ] The port accepts a `VideoValidationRequested` event shape.
- [ ] The in-memory adapter stores the last published payload.
- [ ] The adapter is ready to be replaced by a RabbitMQ publisher in a future slice.

**Tests**: unit
**Gate**: full
**Status**: Complete

---

#### T3: Create CreateProcessingRequest use case

**What**: Implement the application use case that creates a request, saves it, and publishes `VideoValidationRequested` as documented JSON.

**Where**: `src/application/create-processing-request.use-case.ts`

**Depends on**: T2, T4

**Reuses**: `src/domain/processing-request.ts`, `src/infrastructure/in-memory-processing-request.repository.ts`, `src/infrastructure/in-memory-event-publisher.ts`

**Requirement**: CAT-01, CAT-02, CAT-03, CAT-04

**Tools**:

- Skill: `tlc-spec-driven`

**Done when**:

- [ ] Valid input creates one `ProcessingRequest` in `RECEIVED` state.
- [ ] The use case publishes a `VideoValidationRequested` JSON event with all documented fields.
- [ ] A repeated `eventId` produces no new request, transition, or event.
- [ ] Missing input rejects without persisting or publishing.

**Tests**: unit
**Gate**: full
**Status**: Complete

---

### Phase 3: Interface wiring

```
T3 → T5
```

#### T5: Create NestJS controller and DTO

**What**: Wire the use case into a NestJS controller with a local DTO for request creation input.

**Where**: `src/interface/create-processing-request.controller.ts`

**Depends on**: T3

**Reuses**: `src/application/create-processing-request.use-case.ts`

**Requirement**: CAT-01, CAT-04

**Tools**:

- Skill: `tlc-spec-driven`

**Done when**:

- [ ] The controller exposes an endpoint that accepts `ownerUserId` and `sourceStorageKey`.
- [ ] The DTO validates required fields using NestJS decorators.
- [ ] The module wires controller, use case, repository, and publisher together.

**Tests**: integration
**Gate**: full
**Status**: Complete

---

### Phase 4: Tests and final gates

```
T6 → T7
```

#### T6: Add unit tests for aggregate, repository, and use case

**What**: Cover the domain and application layers with unit tests that prove creation, event emission, and idempotency.

**Where**: `src/application/create-processing-request.use-case.spec.ts`

**Depends on**: T2, T3

**Reuses**: All domain and application files created above.

**Requirement**: CAT-01, CAT-02, CAT-03, CAT-04

**Tools**:

- Skill: `tlc-spec-driven`

**Done when**:

- [ ] Tests pass for happy path, duplicate `eventId`, and missing-field rejection.
- [ ] Tests assert the exact JSON fields of `VideoValidationRequested`.

**Tests**: unit
**Gate**: full
**Status**: Complete

---

#### T7: Add Nest integration tests and run final gates

**What**: Add an end-to-end or controller integration test, then run lint, test, and build gates.

**Where**: `test/app.e2e-spec.ts`

**Depends on**: T5, T6

**Reuses**: The Nest application module.

**Requirement**: CAT-01, CAT-02, CAT-03, CAT-04

**Tools**:

- Skill: `tlc-spec-driven`

**Done when**:

- [ ] Integration test exercises the create endpoint and asserts the emitted event JSON.
- [ ] `npm run lint` passes with no warnings.
- [ ] `npm test` passes.
- [ ] `npm run build` succeeds.

**Tests**: integration
**Gate**: build
**Status**: Complete

## Phase Execution Map

```
Phase 1: T1 → T2
Phase 2: T4 → T3
Phase 3: T3 → T5
Phase 4: T6 → T7
```

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1 | One aggregate file | ✅ Granular |
| T2 | One repository adapter file | ✅ Granular |
| T3 | One use case file | ✅ Granular |
| T4 | One publisher adapter file | ✅ Granular |
| T5 | One controller file | ✅ Granular |
| T6 | One test file | ✅ Granular |
| T7 | One integration test + gates | ✅ Granular |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | None | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2, T4 | T4 → T3 | ✅ Match |
| T4 | None | None | ✅ Match |
| T5 | T3 | T3 → T5 | ✅ Match |
| T6 | T2, T3 | None | ✅ Match |
| T7 | T5, T6 | T6 → T7 | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Domain aggregate | unit | unit | ✅ OK |
| T2 | Repository adapter | unit | unit | ✅ OK |
| T3 | Application use case | unit | unit | ✅ OK |
| T4 | Event publisher adapter | unit | unit | ✅ OK |
| T5 | Controller/DTO | integration | integration | ✅ OK |
| T6 | Unit tests | unit | unit | ✅ OK |
| T7 | Integration tests + gates | integration | integration | ✅ OK |
