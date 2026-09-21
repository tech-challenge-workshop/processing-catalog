# Full Lifecycle Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/full-lifecycle/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `.specs/features/local-docker-integration/tasks.md` (prior matrix for this repository), `test/jest-e2e.json`, `package.json` scripts. No coverage threshold is configured anywhere in the repository.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Domain aggregate | unit | All branches; 1:1 to spec ACs; every permitted and every forbidden transition asserted, including that prior state is unchanged on rejection | `src/domain/*.spec.ts` | `npm test` |
| Application use cases | unit | Happy path, duplicate `eventId`, forbidden transition, unknown request, unknown failure code, publication failure | `src/application/*.spec.ts` | `npm test` |
| RabbitMQ consumers | unit | Valid payload, malformed payload, duplicate, and that a publication failure prevents the ack | `src/infrastructure/rabbitmq/*.spec.ts` | `npm test` |
| Messaging DTOs | none | Build gate only - they declare shape and carry no behaviour | `src/messaging/dto/*.ts` | build gate only |
| Full lifecycle | e2e | Both terminal paths end to end through the fake broker, plus replay | `test/*.e2e-spec.ts` | `npm run test:e2e` |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | After tasks with unit tests only | `npm test` |
| Full | After tasks touching consumers or the e2e path | `npm test && npm run test:e2e` |
| Build | After phase completion or DTO-only tasks | `npm run lint && npm test && npm run test:e2e && npm run build` |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Domain

```
T1 → T2 → T3 → T4 → T5
```

### Phase 2: Contract and application

```
T6 → T7 → T8 → T9
```

### Phase 3: Infrastructure

```
T10 → T11 → T12 → T13
```

### Phase 4: End-to-end

```
T14
```

---

## Task Breakdown

### T1: Add the failure code vocabulary to the aggregate

**What**: Declare the `FailureCode` union and add an optional `failureCode` field to `ProcessingRequest`, initialised as undefined on creation.
**Where**: `src/domain/processing-request.ts`
**Depends on**: None
**Reuses**: The existing `ProcessingRequestStatus` enum style
**Requirement**: LC-03, LC-04, LC-08

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `FailureCode` is a closed union of `FORMATO_INVALIDO`, `DURACAO_EXCEDIDA` and `PROCESSAMENTO_FALHOU`
- [ ] `createProcessingRequest` leaves `failureCode` undefined
- [ ] Unit tests assert a new request carries no failure code
- [ ] Quick gate passes: `npm test`

**Tests**: unit
**Gate**: quick

---

### T2: Add the `startProcessingRequest` transition

**What**: Add the pure transition from `QUEUED` to `PROCESSING`, rejecting every other source state.
**Where**: `src/domain/processing-request.ts` (modify)
**Depends on**: T1
**Reuses**: `acceptProcessingRequest` structure and its `ProcessingRequestDomainError` convention
**Requirement**: LC-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A `QUEUED` request becomes `PROCESSING` with `updatedAt` refreshed
- [ ] Every other source state throws `ProcessingRequestDomainError`
- [ ] A test asserts the request is unchanged after a rejected transition, not merely that it threw
- [ ] Quick gate passes: `npm test`

**Tests**: unit
**Gate**: quick

---

### T3: Add the `failProcessingRequest` transition

**What**: Add the pure transition to `FAILED` from `RECEIVED`, `QUEUED` or `PROCESSING`, recording the failure code.
**Where**: `src/domain/processing-request.ts` (modify)
**Depends on**: T2
**Reuses**: The same transition shape
**Requirement**: LC-03, LC-04, LC-05

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Each of the three permitted source states reaches `FAILED` with the code recorded
- [ ] A terminal source state throws and leaves the request unchanged
- [ ] A test asserts the stored `failureCode` value, not only the resulting status
- [ ] Quick gate passes: `npm test`

**Tests**: unit
**Gate**: quick

---

### T4: Require `PROCESSING` before completion

**What**: Tighten `completeProcessingRequest` so it accepts only a `PROCESSING` request, replacing the current `QUEUED` guard.
**Where**: `src/domain/processing-request.ts` (modify)
**Depends on**: T3
**Reuses**: The existing function and its error message style
**Requirement**: LC-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A `PROCESSING` request completes and records the `zipStorageKey`
- [ ] A `QUEUED` request is rejected, covering the edge case that a completion without a start means a lost `ProcessingStarted`
- [ ] Existing domain tests that assumed completion from `QUEUED` are updated to drive the full sequence, and no assertion is weakened
- [ ] Quick gate passes: `npm test`

**Tests**: unit
**Gate**: quick

---

### T5: Add the failure reason mapping

**What**: Add a total function turning a `FailureCode` into the one user-facing sentence published for it, with no default branch.
**Where**: `src/domain/failure-reason.ts`
**Depends on**: T4
**Reuses**: The `FailureCode` union from T1
**Requirement**: LC-12, LC-13

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Every member of the union maps to a distinct sentence
- [ ] Adding a member without mapping it fails the type check rather than returning a generic sentence
- [ ] A test asserts no produced sentence contains a storage key, a stack trace or an internal identifier
- [ ] Build gate passes: `npm run lint && npm test && npm run test:e2e && npm run build`

**Tests**: unit
**Gate**: build

---

### T6: Widen the terminal event contract

**What**: Make `zipStorageKey` optional, add optional `failureReason` and `attemptId` to `TerminalEventDto`.
**Where**: `src/messaging/dto/terminal-event.dto.ts`
**Depends on**: T5
**Reuses**: The shape the Notification Service already declares in its own DTO
**Requirement**: LC-11

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `zipStorageKey` and `failureReason` are both optional
- [ ] The existing publisher and its tests compile against the widened shape with no assertion weakened
- [ ] Quick gate passes: `npm test`

**Tests**: none
**Gate**: quick

---

### T7: Add the `StartProcessingRequestUseCase`

**What**: Add the use case that consumes a start event and drives the `QUEUED` to `PROCESSING` transition, publishing no terminal event.
**Where**: `src/application/start-processing-request.use-case.ts`
**Depends on**: T6
**Reuses**: `accept-processing-request.use-case.ts` structure line for line
**Requirement**: LC-01, LC-07

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A valid event transitions the request and publishes nothing
- [ ] A duplicate `eventId` returns the existing request and applies no second transition
- [ ] An unknown `processingRequestId` is rejected and creates no request
- [ ] A forbidden source state is rejected and leaves the stored state unchanged
- [ ] Quick gate passes: `npm test`

**Tests**: unit
**Gate**: quick

---

### T8: Add the `RejectProcessingRequestUseCase`

**What**: Add the use case that consumes a rejection, moves the request to `FAILED`, and publishes one terminal event carrying the mapped reason.
**Where**: `src/application/reject-processing-request.use-case.ts`
**Depends on**: T7
**Reuses**: The same use-case structure and `failureReasonFor` from T5
**Requirement**: LC-03, LC-08, LC-10, LC-12, LC-13, LC-14

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A valid rejection reaches `FAILED` and publishes exactly one terminal event
- [ ] The published event carries `status` `FAILED` and a `failureReason`, and carries no `zipStorageKey`
- [ ] An unrecognised failure code is rejected before the domain is touched
- [ ] A duplicate `eventId` publishes no second event
- [ ] A publication failure propagates and the event is not marked processed
- [ ] Quick gate passes: `npm test`

**Tests**: unit
**Gate**: quick

---

### T9: Add the `FailProcessingRequestUseCase`

**What**: Add the use case that consumes a processing failure from `QUEUED` or `PROCESSING` and publishes one terminal event.
**Where**: `src/application/fail-processing-request.use-case.ts`
**Depends on**: T8
**Reuses**: The `RejectProcessingRequestUseCase` from T8
**Requirement**: LC-04, LC-05, LC-10, LC-14

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Both permitted source states reach `FAILED` and publish exactly one terminal event each
- [ ] A request already terminal is rejected and its stored state is unchanged
- [ ] The published event carries the `attemptId` when the request had one, and omits it otherwise
- [ ] Build gate passes: `npm run lint && npm test && npm run test:e2e && npm run build`

**Tests**: unit
**Gate**: build

---

### T10: Add the `VideoRejectedConsumer`

**What**: Bind the `video.rejected` queue to the rejection use case.
**Where**: `src/infrastructure/rabbitmq/video-rejected.consumer.ts`
**Depends on**: T9
**Reuses**: `video-accepted.consumer.ts` structure, including its nack policy
**Requirement**: LC-03, LC-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A valid message delegates to the use case and is acked
- [ ] A payload missing `processingRequestId` or `failureCode` is nacked without requeue
- [ ] A technical fault is nacked **with** requeue, matching the existing policy
- [ ] `handleMessage` is exercised directly, with no broker required
- [ ] Quick gate passes: `npm test`

**Tests**: unit
**Gate**: quick

---

### T11: Add the `ProcessingStartedConsumer`

**What**: Bind the `processing.started` queue to the start use case.
**Where**: `src/infrastructure/rabbitmq/processing-started.consumer.ts`
**Depends on**: T10
**Reuses**: The consumer structure from T10
**Requirement**: LC-01, LC-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A valid message transitions the request and is acked
- [ ] A malformed payload is nacked without requeue
- [ ] A duplicate delivery applies no second transition
- [ ] Quick gate passes: `npm test`

**Tests**: unit
**Gate**: quick

---

### T12: Add the `ProcessingFailedConsumer`

**What**: Bind the `processing.failed` queue to the failure use case.
**Where**: `src/infrastructure/rabbitmq/processing-failed.consumer.ts`
**Depends on**: T11
**Reuses**: The consumer structure from T10
**Requirement**: LC-04, LC-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A valid message reaches `FAILED` and is acked
- [ ] A malformed payload is nacked without requeue
- [ ] A publication failure prevents the ack
- [ ] Quick gate passes: `npm test`

**Tests**: unit
**Gate**: quick

---

### T13: Wire the new use cases and consumers into the module

**What**: Register the three use cases and three consumers in the application module.
**Where**: `src/app.module.ts` (modify)
**Depends on**: T12
**Reuses**: The existing provider list and its `useExisting` token bindings
**Requirement**: LC-01, LC-03, LC-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] All three use cases and all three consumers are registered
- [ ] The application boots with the fake connection in the existing e2e setup
- [ ] Full gate passes: `npm test && npm run test:e2e`

**Tests**: e2e
**Gate**: full

---

### T14: Cover the full lifecycle end to end

**What**: Extend the local e2e suite to drive both terminal paths and their replay through the fake broker.
**Where**: `test/local-docker-integration.e2e-spec.ts` (modify)
**Depends on**: T13
**Reuses**: `FakeRabbitMQConnection` and its `deliver()` helper, already contract-checked through `RabbitMQConnectionContract`
**Requirement**: LC-01, LC-02, LC-03, LC-04, LC-07, LC-09, LC-10, LC-11

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] One request reaches `COMPLETED` through `VideoAccepted`, `ProcessingStarted`, `ProcessingCompleted`, publishing one terminal event with a `zipStorageKey` and no `failureReason`
- [ ] One request reaches `FAILED` through `VideoRejected`, publishing one terminal event with a `failureReason` and no `zipStorageKey`
- [ ] One request reaches `FAILED` through `ProcessingFailed` after `ProcessingStarted`
- [ ] Replaying every delivered event changes no stored state and publishes nothing further
- [ ] Each published event is asserted by destination queue and pattern, not only by payload
- [ ] Build gate passes: `npm run lint && npm test && npm run test:e2e && npm run build`

**Tests**: e2e
**Gate**: build

**Commit**: `feat(lifecycle): reach PROCESSING and FAILED`

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4

Phase 1:  T1 ------→ T2 ------→ T3 ------→ T4 ------→ T5
Phase 2:  T6 ------→ T7 ------→ T8 ------→ T9
Phase 3:  T10 ------→ T11 ------→ T12 ------→ T13
Phase 4:  T14

Phase boundaries (the last task of a phase gates the first task of the next):
          T5 ------→ T6
          T9 ------→ T10
          T13 ------→ T14
```

Total: 14 tasks. This packs into two batches at the ~7-task worker budget: Phases 1-2 (9 tasks) and Phases 3-4 (5 tasks). Execute should offer batch sub-agents.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: Failure code vocabulary | 1 type + 1 field | ✅ Granular |
| T2: `startProcessingRequest` | 1 function | ✅ Granular |
| T3: `failProcessingRequest` | 1 function | ✅ Granular |
| T4: Tighten completion guard | 1 function | ✅ Granular |
| T5: Failure reason mapping | 1 function | ✅ Granular |
| T6: Widen terminal DTO | 1 file | ✅ Granular |
| T7: Start use case | 1 class | ✅ Granular |
| T8: Reject use case | 1 class | ✅ Granular |
| T9: Fail use case | 1 class | ✅ Granular |
| T10: Rejected consumer | 1 class | ✅ Granular |
| T11: Started consumer | 1 class | ✅ Granular |
| T12: Failed consumer | 1 class | ✅ Granular |
| T13: Module wiring | 1 file | ✅ Granular |
| T14: End-to-end coverage | 1 suite | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | no inbound arrow | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | T3 | T3 → T4 | ✅ Match |
| T5 | T4 | T4 → T5 | ✅ Match |
| T6 | T5 | T5 → T6 (phase boundary) | ✅ Match |
| T7 | T6 | T6 → T7 | ✅ Match |
| T8 | T7 | T7 → T8 | ✅ Match |
| T9 | T8 | T8 → T9 | ✅ Match |
| T10 | T9 | T9 → T10 (phase boundary) | ✅ Match |
| T11 | T10 | T10 → T11 | ✅ Match |
| T12 | T11 | T11 → T12 | ✅ Match |
| T13 | T12 | T12 → T13 | ✅ Match |
| T14 | T13 | T13 → T14 (phase boundary) | ✅ Match |

No task depends on a task in a later phase.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Domain aggregate | unit | unit | ✅ OK |
| T2 | Domain aggregate | unit | unit | ✅ OK |
| T3 | Domain aggregate | unit | unit | ✅ OK |
| T4 | Domain aggregate | unit | unit | ✅ OK |
| T5 | Domain aggregate | unit | unit | ✅ OK |
| T6 | Messaging DTO | none | none | ✅ OK |
| T7 | Application use case | unit | unit | ✅ OK |
| T8 | Application use case | unit | unit | ✅ OK |
| T9 | Application use case | unit | unit | ✅ OK |
| T10 | RabbitMQ consumer | unit | unit | ✅ OK |
| T11 | RabbitMQ consumer | unit | unit | ✅ OK |
| T12 | RabbitMQ consumer | unit | unit | ✅ OK |
| T13 | Module wiring enabling the consumers | e2e | e2e | ✅ OK |
| T14 | Full lifecycle | e2e | e2e | ✅ OK |

T6 is the only `Tests: none`, and the matrix assigns `none` to the DTO layer because it declares shape and carries no behaviour. Its correctness is proven where it is used, by T8, T9 and T14, each of which asserts the published payload field by field.

T13 carries `e2e` rather than deferring: module wiring is what makes the consumers reachable, so its verification is the first point at which they can run at all.
