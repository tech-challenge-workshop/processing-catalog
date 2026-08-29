# Catalog Local Docker Integration Tasks

## Execution Protocol

Implement these tasks with the `tlc-spec-driven` skill and its Execute flow. All code changes stay inside the `processing-catalog` repository. Each task must leave the existing NestJS quality gates green: `npm test`, `npm run lint`, and `npm run build`. No PostgreSQL, migrations, transactional outbox, or shared contracts package is introduced in this slice.

**Design**: `.specs/features/local-docker-integration/design.md`
**Status**: In Progress
**TLC references**: `/Volumes/HIKSEMI/repository/fiap-x/fiapx/.agents/skills/tlc-spec-driven/references/implement.md`, `/Volumes/HIKSEMI/repository/fiap-x/fiapx/.agents/skills/tlc-spec-driven/references/validate.md`

## Test Coverage Matrix

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Domain aggregate | unit | State machine, valid transitions, invalid transition rejection, `attemptId` generation. | `src/domain/*.spec.ts` | `npm test` |
| Application use cases | unit | Accept and complete happy path, duplicate `eventId`, missing `processingRequestId`, unsupported transition, publication failure. | `src/application/*.spec.ts` | `npm test` |
| RabbitMQ consumers | unit | Valid consumed events, invalid events, duplicate handling, publication failure blocks acknowledgment. | `src/infrastructure/rabbitmq/*.spec.ts` | `npm test` |
| Event publisher adapters | unit | In-memory records all event shapes; RabbitMQ publisher serializes to the configured exchange. | `src/infrastructure/*.spec.ts` | `npm test` |
| Health/observation interface | integration/e2e | Health returns 200 when RabbitMQ is up and 503 when down; observation endpoint exists only under `LOCAL_INTEGRATION=true`. | `test/*.e2e-spec.ts` | `npm test` |
| Local lifecycle | e2e | Create request, publish/consume through broker, assert `RECEIVED → QUEUED → COMPLETED` and terminal event. | `test/*.e2e-spec.ts` | `npm run test:e2e` |
| Lint/format | static | Zero errors and zero warnings. | `src/**/*.ts`, `test/**/*.ts` | `npm run lint` |
| Build | compilation | `dist/` produced without TypeScript errors. | `src/**/*.ts` | `npm run build` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | After any TypeScript change | `npm run lint` |
| Full | After completing a task with logic | `npm test` |
| Build | Before marking the feature done | `npm run build` |
| e2e | After RabbitMQ wiring is complete | `npm run test:e2e` |

## Execution Plan

```
Phase 1: Contracts and domain model → Phase 2: Application behavior → Phase 3: RabbitMQ infrastructure → Phase 4: Interface wiring → Phase 5: Containerization and quality gaps → Phase 6: Integration tests and final gates
P1 → P2 → P3 → P4 → P5 → P6
```

## Task Breakdown

### Phase 1: Contracts and domain model

```
T2 → T3 → T4
T1 → T5
```

#### T1: Create local RabbitMQ event DTOs

**What**: Define TypeScript interfaces for consumed events (`VideoAcceptedDto`, `ProcessingCompletedDto`) and published events (`ProcessingQueuedDto`, `TerminalEventDto`). Reuse the existing `VideoValidationRequestedEvent` shape.

**Where**: `src/messaging/dto/`

**Depends on**: None

**Reuses**: `docs/foudation.md` event contracts

**Requirement**: CAT-01, CAT-02, CAT-03

**Tools**:

- Skill: `tlc-spec-driven`

**Done when**:

- [x] DTOs mirror the documented JSON fields exactly.
- [x] DTOs are local to the Catalog repository.

**Tests**: unit
**Gate**: full
**Status**: Done

---

#### T2: Extend ProcessingRequest aggregate with transitions

**What**: Add `acceptProcessingRequest` and `completeProcessingRequest` functions, `attemptId` and `zipStorageKey` fields, and explicit rejection of unsupported transitions.

**Where**: `src/domain/processing-request.ts`

**Depends on**: None

**Reuses**: `src/domain/processing-request.ts` (existing factory)

**Requirement**: CAT-02, CAT-03, CAT-05, CAT-09

**Tools**:

- Skill: `tlc-spec-driven`

**Done when**:

- [x] `acceptProcessingRequest` transitions `RECEIVED → QUEUED` and generates a stable `attemptId`.
- [x] `completeProcessingRequest` transitions `QUEUED → COMPLETED` and stores `zipStorageKey`.
- [x] Unsupported transitions throw `ProcessingRequestDomainError` and leave the prior state unchanged.

**Tests**: unit
**Gate**: full
**Status**: Done

---

#### T3: Extend repository port for updates and deduplication

**What**: Add `update(request)` to the repository port and keep `markEventProcessed` / `hasEventBeenProcessed` for event deduplication.

**Where**: `src/domain/processing-request.repository.ts`

**Depends on**: T2

**Reuses**: `src/domain/processing-request.repository.ts`

**Requirement**: CAT-02, CAT-03, CAT-04

**Tools**:

- Skill: `tlc-spec-driven`

**Done when**:

- [x] The port exposes `update` alongside existing save/find methods.
- [x] The port keeps processed-event tracking.

**Tests**: unit
**Gate**: full
**Status**: Done

---

#### T4: Update in-memory repository adapter

**What**: Update the in-memory adapter to implement `update` and processed-event tracking.

**Where**: `src/infrastructure/in-memory-processing-request.repository.ts`

**Depends on**: T3

**Reuses**: `src/infrastructure/in-memory-processing-request.repository.ts`

**Requirement**: CAT-02, CAT-03, CAT-04

**Tools**:

- Skill: `tlc-spec-driven`

**Done when**:

- [x] The adapter overwrites the stored request on `update`.
- [x] Unit tests prove update and deduplication.

**Tests**: unit
**Gate**: full
**Status**: Done

---

### Phase 2: Application behavior

```
T1 → T5 → T6
T1 → T5 → T7
T4 → T6
T4 → T7
```

#### T5: Refactor EventPublisher port for multiple event shapes

**What**: Expand the `EventPublisher` interface to expose explicit methods for `VideoValidationRequested`, `ProcessingQueued`, and the terminal event.

**Where**: `src/application/event-publisher.ts`

**Depends on**: T1

**Reuses**: `src/application/event-publisher.ts`

**Requirement**: CAT-01, CAT-02, CAT-03

**Tools**:

- Skill: `tlc-spec-driven`

**Done when**:

- [x] The port declares `publishVideoValidationRequested`, `publishProcessingQueued`, and `publishTerminalEvent`.
- [x] Existing `CreateProcessingRequestUseCase` is updated to call the new method.
- [x] Tests still pass.

**Tests**: unit
**Gate**: full
**Status**: Done

---

#### T6: Create AcceptProcessingRequest use case

**What**: Implement the use case that consumes `VideoAccepted`, transitions `RECEIVED → QUEUED`, and publishes `ProcessingQueued`.

**Where**: `src/application/accept-processing-request.use-case.ts`

**Depends on**: T1, T4, T5

**Reuses**: `src/domain/processing-request.ts`, `src/domain/processing-request.repository.ts`

**Requirement**: CAT-02, CAT-04, CAT-05, CAT-06

**Tools**:

- Skill: `tlc-spec-driven`

**Done when**:

- [x] Valid `VideoAccepted` produces a `QUEUED` request and publishes `ProcessingQueued` with `attemptId`.
- [x] Duplicate `eventId` produces no second transition or event.
- [x] Missing `processingRequestId` or unsupported transition rejects without publishing and without state change.
- [x] Publication failure propagates and leaves the source event unacknowledged.

**Tests**: unit
**Gate**: full
**Status**: Done

---

#### T7: Create CompleteProcessingRequest use case

**What**: Implement the use case that consumes `ProcessingCompleted`, transitions `QUEUED → COMPLETED`, and publishes the terminal event.

**Where**: `src/application/complete-processing-request.use-case.ts`

**Depends on**: T1, T4, T5

**Reuses**: `src/domain/processing-request.ts`, `src/domain/processing-request.repository.ts`

**Requirement**: CAT-03, CAT-04, CAT-05, CAT-06

**Tools**:

- Skill: `tlc-spec-driven`

**Done when**:

- [x] Valid `ProcessingCompleted` produces a `COMPLETED` request and publishes the terminal event with `status`, `zipStorageKey`, and `ownerUserId`.
- [x] Duplicate `eventId` produces no second transition or event.
- [x] Missing `processingRequestId` or unsupported transition rejects without publishing and without state change.
- [x] Publication failure propagates and leaves the source event unacknowledged.

**Tests**: unit
**Gate**: full
**Status**: Done

---

### Phase 3: RabbitMQ infrastructure

```
T5 → T8
T5 → T10
T6 → T9
T7 → T9
T8 → T9
```

#### T8: Implement RabbitMQ publisher adapter and connection manager

**What**: Create `RabbitMQModule`, `RabbitMQConnection`, and `RabbitMQEventPublisher`. The publisher serializes events to JSON and publishes them to the local `fiapx.events` exchange with the correct routing key.

**Where**: `src/infrastructure/rabbitmq/`

**Depends on**: T5

**Reuses**: `src/application/event-publisher.ts`

**Requirement**: CAT-01, CAT-02, CAT-03, CAT-06

**Tools**:

- Skill: `tlc-spec-driven`

**Done when**:

- [x] Connection is established from `RABBITMQ_URL` (default `amqp://rabbitmq:5672`).
- [x] Topology (exchange, queues, bindings) is declared at startup.
- [x] `RabbitMQEventPublisher` implements the expanded `EventPublisher` port.
- [x] Unit tests prove serialization and exchange/routing-key selection.

**Tests**: unit
**Gate**: full
**Status**: Done

---

#### T9: Implement RabbitMQ consumers for VideoAccepted and ProcessingCompleted

**What**: Create `VideoAcceptedConsumer` and `ProcessingCompletedConsumer` that deserialize messages and call the corresponding use cases. Ack only on success; do not ack on publication failure.

**Where**: `src/infrastructure/rabbitmq/`

**Depends on**: T6, T7, T8

**Reuses**: `src/application/accept-processing-request.use-case.ts`, `src/application/complete-processing-request.use-case.ts`

**Requirement**: CAT-02, CAT-03, CAT-05, CAT-06

**Tools**:

- Skill: `tlc-spec-driven`

**Done when**:

- [x] Consumers listen on `video.accepted` and `processing.completed` queues.
- [x] Valid events trigger state transitions and follow-up publications.
- [x] Invalid events are rejected without acknowledgment.
- [x] Publication failure leaves the source message unacknowledged.
- [x] Unit tests cover valid, invalid, duplicate, and publication-failure paths.

**Tests**: unit
**Gate**: full
**Status**: Done

---

#### T10: Update in-memory event publisher for multiple event shapes

**What**: Extend `InMemoryEventPublisher` to record `ProcessingQueued` and terminal events alongside `VideoValidationRequested`, with typed accessors for tests.

**Where**: `src/infrastructure/in-memory-event-publisher.ts`

**Depends on**: T5

**Reuses**: `src/infrastructure/in-memory-event-publisher.ts`

**Requirement**: CAT-01, CAT-02, CAT-03

**Tools**:

- Skill: `tlc-spec-driven`

**Done when**:

- [x] The adapter implements the expanded `EventPublisher` port.
- [x] Tests can assert each published shape independently.

**Tests**: unit
**Gate**: full
**Status**: Done

---

### Phase 4: Interface wiring

```
T4 → T11
T8 → T12
T12 → T13
T11 → T14
T12 → T14
T13 → T14
```

#### T11: Add local-only request observation controller

**What**: Add a `GET /processing-requests/:id` endpoint that returns the current request state. Register the controller only when `LOCAL_INTEGRATION=true`.

**Where**: `src/interface/processing-request-observation.controller.ts`

**Depends on**: T4

**Reuses**: `src/domain/processing-request.repository.ts`

**Requirement**: CAT-07

**Tools**:

- Skill: `tlc-spec-driven`

**Done when**:

- [x] Endpoint returns 200 with request state when `LOCAL_INTEGRATION=true`.
- [x] Endpoint is absent and returns 404 when the flag is not set.
- [x] Integration test proves both behaviors.

**Tests**: integration
**Gate**: full
**Status**: Done

---

#### T12: Create RabbitMQ health indicator

**What**: Add a health indicator that reports `up` only when the RabbitMQ connection is open.

**Where**: `src/infrastructure/rabbitmq/rabbitmq.health-indicator.ts`

**Depends on**: T8

**Reuses**: `src/infrastructure/rabbitmq/rabbitmq.connection.ts`

**Requirement**: Edge case: RabbitMQ unavailable → readiness false

**Tools**:

- Skill: `tlc-spec-driven`

**Done when**:

- [x] Indicator returns `up` when connected and `down` when disconnected.
- [x] Unit tests prove both states.

**Tests**: unit
**Gate**: full
**Status**: Done

---

#### T13: Add health endpoint

**What**: Add `GET /health` that aggregates the RabbitMQ health indicator and returns 200 when up, 503 when down.

**Where**: `src/interface/health.controller.ts`

**Depends on**: T12

**Reuses**: `src/infrastructure/rabbitmq/rabbitmq.health-indicator.ts`

**Requirement**: Edge case: RabbitMQ unavailable → readiness false

**Tools**:

- Skill: `tlc-spec-driven`

**Done when**:

- [x] `/health` reflects the RabbitMQ connection state.
- [x] Integration tests assert 200/503 states.

**Tests**: integration
**Gate**: full
**Status**: Done

---

#### T14: Update AppModule wiring for RabbitMQ, health, and conditional controller

**What**: Wire `RabbitMQModule`, health indicator, health controller, and the conditional observation controller into `AppModule`.

**Where**: `src/app.module.ts`

**Depends on**: T8, T11, T12, T13

**Reuses**: `src/app.module.ts`

**Requirement**: CAT-07, RabbitMQ readiness

**Tools**:

- Skill: `tlc-spec-driven`

**Done when**:

- [x] `RabbitMQModule` and health providers are registered.
- [x] Observation controller is registered only when `LOCAL_INTEGRATION=true`.
- [x] Build passes.

**Tests**: integration
**Gate**: full
**Status**: Done

---

### Phase 5: Containerization and quality gaps

```
T2 → T16
T17 → T18
T5 → T18
T10 → T18
```

#### T15: Add Catalog Dockerfile and .dockerignore

**What**: Create a production-ready `Dockerfile` for the Catalog service and a `.dockerignore` that excludes build artifacts and AppleDouble files.

**Where**: `Dockerfile`

**Depends on**: None

**Reuses**: `package.json`, `nest-cli.json`

**Requirement**: Containerization for local integration

**Tools**:

- Skill: `tlc-spec-driven`

**Done when**:

- [x] `docker build -t processing-catalog .` succeeds.
- [x] Image runs `node dist/main` on port 3000.
- [x] `.dockerignore` excludes `node_modules`, `dist`, `.env`, `.git`, and `._*`.

**Tests**: none
**Gate**: build
**Status**: Done

---

#### T16: Add aggregate test for unsupported transitions

**What**: Add a direct aggregate test asserting that `acceptProcessingRequest` and `completeProcessingRequest` reject invalid transitions and leave the prior state unchanged.

**Where**: `src/domain/processing-request.spec.ts`

**Depends on**: T2

**Reuses**: `src/domain/processing-request.ts`

**Requirement**: CAT-09

**Tools**:

- Skill: `tlc-spec-driven`

**Done when**:

- [x] Test asserts `RECEIVED → COMPLETED` is rejected.
- [x] Test asserts `QUEUED → QUEUED` is rejected.
- [x] Prior state remains unchanged after rejection.

**Tests**: unit
**Gate**: full
**Status**: Done

---

#### T17: Fix lint warning in controller spec

**What**: Resolve the existing `@typescript-eslint/no-unsafe-argument` warning in the controller spec without disabling the rule globally.

**Where**: `src/interface/create-processing-request.controller.spec.ts`

**Depends on**: None

**Reuses**: `src/interface/create-processing-request.controller.spec.ts`

**Requirement**: CAT-08

**Tools**:

- Skill: `tlc-spec-driven`

**Done when**:

- [x] `npm run lint` reports zero warnings.
- [x] The spec still exercises the controller correctly.

**Tests**: unit
**Gate**: full
**Status**: Done

---

#### T18: Update AppModule and existing tests for expanded EventPublisher port

**What**: Update `AppModule` provider wiring and any existing tests that reference the old `EventPublisher` interface to use the new multi-shape port.

**Where**: `src/app.module.ts`

**Depends on**: T5, T10, T17

**Reuses**: Existing specs

**Requirement**: CAT-01, CAT-08

**Tools**:

- Skill: `tlc-spec-driven`

**Done when**:

- [x] `AppModule` binds the appropriate event publisher to the expanded `EventPublisher` token.
- [x] All existing unit and e2e tests pass.
- [x] Lint passes with zero warnings.

**Tests**: unit + integration
**Gate**: full
**Status**: Done

---

### Phase 6: Integration tests and final gates

```
T15 → T20
T16 → T20
T18 → T19
T9 → T19
T14 → T19
T19 → T20
```

#### T19: Add e2e test for local RabbitMQ lifecycle

**What**: Add an end-to-end test that boots the Nest app with an in-memory RabbitMQ fake, creates a request, feeds `VideoAccepted` and `ProcessingCompleted`, and asserts `RECEIVED → QUEUED → COMPLETED` plus the terminal event.

**Where**: `test/local-docker-integration.e2e-spec.ts`

**Depends on**: T9, T14, T18

**Reuses**: All application and infrastructure files created above.

**Requirement**: CAT-01, CAT-02, CAT-03, CAT-04, CAT-05, CAT-06, CAT-07

**Tools**:

- Skill: `tlc-spec-driven`

**Done when**:

- [x] e2e test exercises the full `RECEIVED → QUEUED → COMPLETED` path.
- [x] Duplicate and invalid events are asserted to have no effect.
- [x] Local observation endpoint is verified under `LOCAL_INTEGRATION=true`.

**Tests**: e2e
**Gate**: full
**Status**: Done

---

#### T20: Run final gates and update requirement traceability

**What**: Run lint, unit tests, build, and e2e tests; mark requirements as verified in the spec traceability table.

**Where**: `.specs/features/local-docker-integration/spec.md`

**Depends on**: T15, T16, T19

**Reuses**: All prior tasks.

**Requirement**: CAT-01..CAT-10

**Tools**:

- Skill: `tlc-spec-driven`

**Done when**:

- [ ] `npm run lint` passes with zero warnings.
- [ ] `npm test` passes.
- [ ] `npm run build` succeeds.
- [ ] `npm run test:e2e` passes.
- [ ] Requirement traceability table in `spec.md` is updated to Done/Verified.

**Tests**: all
**Gate**: build
**Status**: Pending

## Phase Execution Map

```
Phase 1: T1, T2 → T3 → T4
Phase 2: T5 → T6, T7
Phase 3: T8 → T9
          T10
Phase 4: T11
          T12 → T13 → T14
```

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1 | One DTO directory | ✅ Granular |
| T2 | One aggregate file | ✅ Granular |
| T3 | One port file | ✅ Granular |
| T4 | One adapter file | ✅ Granular |
| T5 | One port file + caller update | ✅ Granular |
| T6 | One use case file | ✅ Granular |
| T7 | One use case file | ✅ Granular |
| T8 | One RabbitMQ module directory | ✅ Granular |
| T9 | Two consumer files | ✅ Granular |
| T10 | One in-memory adapter file | ✅ Granular |
| T11 | One controller file | ✅ Granular |
| T12 | One health indicator file | ✅ Granular |
| T13 | One health controller file | ✅ Granular |
| T14 | One module file update | ✅ Granular |
| T15 | Dockerfile + .dockerignore | ✅ Granular |
| T16 | One spec file | ✅ Granular |
| T17 | One spec file | ✅ Granular |
| T18 | One module file update + spec updates | ✅ Granular |
| T19 | One e2e spec file | ✅ Granular |
| T20 | Gate run + traceability update | ✅ Granular |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | None | ✅ Match |
| T2 | None | None | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | T3 | T3 → T4 | ✅ Match |
| T5 | T1 | T1 → T5 | ✅ Match |
| T6 | T1, T4, T5 | T5 → T6 | ✅ Match |
| T7 | T1, T4, T5 | T5 → T7 | ✅ Match |
| T8 | T5 | T5 → T8 | ✅ Match |
| T9 | T6, T7, T8 | T6 → T9, T7 → T9, T8 → T9 | ✅ Match |
| T10 | T5 | T5 → T10 | ✅ Match |
| T11 | T4 | T4 → T11 | ✅ Match |
| T12 | T8 | T8 → T12 | ✅ Match |
| T13 | T12 | T12 → T13 | ✅ Match |
| T14 | T8, T11, T12, T13 | T11 → T14, T12 → T14, T13 → T14 | ✅ Match |
| T15 | None | None | ✅ Match |
| T16 | T2 | T2 → T16 | ✅ Match |
| T17 | None | None | ✅ Match |
| T18 | T5, T10, T17 | T5 → T18, T10 → T18, T17 → T18 | ✅ Match |
| T19 | T9, T14, T18 | T9 → T19, T14 → T19, T18 → T19 | ✅ Match |
| T20 | T15, T16, T19 | T15 → T20, T16 → T20, T19 → T20 | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Messaging DTOs | unit | unit | ✅ OK |
| T2 | Domain aggregate | unit | unit | ✅ OK |
| T3 | Repository port | unit | unit | ✅ OK |
| T4 | Repository adapter | unit | unit | ✅ OK |
| T5 | Event publisher port | unit | unit | ✅ OK |
| T6 | Application use case | unit | unit | ✅ OK |
| T7 | Application use case | unit | unit | ✅ OK |
| T8 | RabbitMQ publisher | unit | unit | ✅ OK |
| T9 | RabbitMQ consumers | unit | unit | ✅ OK |
| T10 | In-memory publisher | unit | unit | ✅ OK |
| T11 | Observation controller | integration | integration | ✅ OK |
| T12 | Health indicator | unit | unit | ✅ OK |
| T13 | Health controller | integration | integration | ✅ OK |
| T14 | Module wiring | integration | integration | ✅ OK |
| T15 | Dockerfile | none | none | ✅ OK |
| T16 | Aggregate spec | unit | unit | ✅ OK |
| T17 | Controller spec | unit | unit | ✅ OK |
| T18 | Module + test updates | unit + integration | unit + integration | ✅ OK |
| T19 | e2e spec | e2e | e2e | ✅ OK |
| T20 | Gate run | all | all | ✅ OK |
