# local-docker-integration Validation

**Date**: 2026-08-28
**Spec**: `.specs/features/local-docker-integration/spec.md`
**Diff range**: `4b8e9f4..60aa71a`
**Verifier**: inline author-verifier (single agent; no delegation)

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1 | ✅ Done | Local RabbitMQ event DTOs |
| T2 | ✅ Done | Aggregate transitions |
| T3 | ✅ Done | Repository port update/dedup |
| T4 | ✅ Done | In-memory adapter update |
| T5 | ✅ Done | EventPublisher multi-shape port |
| T6 | ✅ Done | AcceptProcessingRequest use case |
| T7 | ✅ Done | CompleteProcessingRequest use case |
| T8 | ✅ Done | RabbitMQ publisher/connection |
| T9 | ✅ Done | RabbitMQ consumers |
| T10 | ✅ Done | In-memory publisher multi-shape |
| T11 | ✅ Done | Local-only observation controller |
| T12 | ✅ Done | RabbitMQ health indicator |
| T13 | ✅ Done | Health endpoint |
| T14 | ✅ Done | AppModule wiring |
| T15 | ✅ Done | Dockerfile + .dockerignore |
| T16 | ✅ Done | Aggregate transition tests |
| T17 | ✅ Done | Lint warning fix |
| T18 | ✅ Done | AppModule/test updates for port |
| T19 | ✅ Done | Local RabbitMQ lifecycle e2e test |
| T20 | ✅ Done | Final gates + traceability |
| T21 | ✅ Done | Strengthened negative observation endpoint assertion (added during validation) |

---

## Spec-Anchored Acceptance Criteria

### P1: Own the local processing lifecycle

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| ------------------------- | -------------------- | ----------------------- | ------ |
| WHEN Catalog creates a request, THEN it SHALL publish one `VideoValidationRequested` JSON message with `eventId`, `processingRequestId`, `ownerUserId`, `sourceStorageKey`, and `occurredAt` | One `VideoValidationRequested` event with all five fields | `src/application/create-processing-request.use-case.spec.ts:29` - `expect(published!.eventId).toBe('event-123')` and lines 30-34 | ✅ PASS |
| WHEN Catalog receives valid `VideoAccepted`, THEN it SHALL transition the matching request from `RECEIVED` to `QUEUED` and publish `ProcessingQueued` with owner, source key, attempt ID, and occurred time | Request status `QUEUED`; published event has `ownerUserId`, `sourceStorageKey`, `attemptId`, `occurredAt` | `src/application/accept-processing-request.use-case.spec.ts:42` - `expect(updated.status).toBe(ProcessingRequestStatus.QUEUED)` and lines 51-57 | ✅ PASS |
| WHEN Catalog receives valid `ProcessingCompleted`, THEN it SHALL transition the matching request from `QUEUED` to `COMPLETED` and publish one terminal event with owner, `COMPLETED`, ZIP key, and occurred time | Request status `COMPLETED`; terminal event has `ownerUserId`, `status: 'COMPLETED'`, `zipStorageKey`, `occurredAt` | `src/application/complete-processing-request.use-case.spec.ts:53` - `expect(updated.status).toBe(ProcessingRequestStatus.COMPLETED)` and lines 61-67 | ✅ PASS |
| WHEN the same event ID is received again, THEN Catalog SHALL create no second transition or follow-up event | Duplicate `eventId` yields length `1` for published shape | `src/application/accept-processing-request.use-case.spec.ts:76` - `expect(publisher.publishedProcessingQueued).toHaveLength(1)`; `src/application/complete-processing-request.use-case.spec.ts:88` - `expect(publisher.publishedTerminalEvents).toHaveLength(1)` | ✅ PASS |
| IF an event lacks `processingRequestId` or requests an unsupported transition, THEN Catalog SHALL reject it, retain the prior state, and publish no success event | Throws; published success event length `0`; stored state unchanged | `src/application/accept-processing-request.use-case.spec.ts:85` - `rejects.toThrow('processingRequestId is required')` and line 93; `src/application/complete-processing-request.use-case.spec.ts:124` - `rejects.toThrow('Cannot complete request in COMPLETED status')` and lines 142-148 | ✅ PASS |
| IF required follow-up publication fails, THEN Catalog SHALL surface the failure and SHALL not acknowledge the source message as successful | Error propagates; event not marked processed | `src/application/accept-processing-request.use-case.spec.ts:127` - `rejects.toThrow('broker down')` and line 135; `src/application/complete-processing-request.use-case.spec.ts:157` - `rejects.toThrow('broker down')` and line 166 | ✅ PASS |
| WHEN `LOCAL_INTEGRATION=true`, THEN Catalog SHALL expose a read-only request-state endpoint; IF the flag is absent, THEN it SHALL not expose that endpoint | Local env: `GET /processing-requests/:id` returns 200; non-local env: same request returns 404 | `test/local-docker-integration.e2e-spec.ts:267` - `expect(response.status).toBe(200)`; `test/app.e2e-spec.ts:93` - `expect(response.status).toBe(404)` | ✅ PASS |

### P2: Close Catalog quality gaps

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| WHEN lint runs, THEN Catalog SHALL finish with zero warnings | `npm run lint` exits 0 with no errors/warnings | `npm run lint` executed; no output after eslint run | ✅ PASS |
| WHEN an unsupported transition is attempted, THEN a direct aggregate test SHALL assert the prior state remains unchanged | Throws; prior `status` and `attemptId` unchanged | `src/domain/processing-request.spec.ts:81` - `expect(request.status).toBe(ProcessingRequestStatus.RECEIVED)`; lines 95-110 | ✅ PASS |
| The Catalog SHALL retain AppleDouble exclusions without runtime change | `.dockerignore` excludes `._*` | `.dockerignore:7` - `._*` | ✅ PASS |

**Status**: ✅ All ACs covered

---

## Discrimination Sensor

All mutations run in a temporary git worktree (`/tmp/processing-catalog-sensor`). The real worktree was verified clean after each worktree removal.

| Mutation | File:line | Description | Killed? |
| -------- | --------- | ----------- | ------- |
| 1 | `src/domain/processing-request.ts:55` | Flipped accept guard `!== RECEIVED` → `=== RECEIVED` | ✅ Killed |
| 2 | `src/application/accept-processing-request.use-case.ts:38` | Disabled event deduplication check (`false && hasEventBeenProcessed`) | ✅ Killed |
| 3 | `src/infrastructure/rabbitmq/rabbitmq.health-indicator.ts:12` | Inverted health result `isConnected()` → `!isConnected()` | ✅ Killed |
| 4 | `src/app.module.ts:26` | Forced `ProcessingRequestObservationController` registration regardless of `LOCAL_INTEGRATION` | ✅ Killed |

**Sensor depth**: lightweight targeted (4 mutations)
**Result**: 4/4 killed - PASS ✅

> Note: the initial negative observation endpoint assertion (`GET /processing-requests/any-id` → 404) survived mutation #4 because the controller returns 404 for unknown IDs whether registered or not. The assertion was strengthened to use a known request ID (T21) so the sensor now kills the mutation.

---

## Interactive UAT Results

Not performed — backend-only/infrastructure feature; automated gates and sensor are sufficient.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ |
| Surgical changes | ✅ |
| No scope creep | ✅ (no database, migrations, transactional outbox, or shared contracts) |
| Matches existing patterns | ✅ |
| Spec-anchored outcome check (asserted values match spec) | ✅ |
| Per-layer Coverage Expectation met (domain 1:1 ACs; routes happy+edge+error) | ✅ |
| Every test maps to a spec requirement - no unclaimed tests | ✅ |
| Documented guidelines followed | `tlc-spec-driven` references `implement.md` and `validate.md` |

---

## Edge Cases

- [x] RabbitMQ unavailable → readiness false: `src/interface/health.controller.spec.ts:43` - `expect(response.status).toBe(503)` and `src/infrastructure/rabbitmq/rabbitmq.health-indicator.spec.ts:14` - `expect(indicator.isHealthy()).toBe(false)`.

---

## Gate Check

- **Gate command**: `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e`
- **Result**: all passed
- **Test count before feature** (`96a55ae`): unit 18 passed, e2e 3 passed
- **Test count after feature** (`60aa71a`): unit 56 passed, e2e 9 passed
- **Delta**: +38 unit tests, +6 e2e tests
- **Skipped tests**: none
- **Failures**: none

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| CAT-01 | Pending | ✅ Verified |
| CAT-02 | Pending | ✅ Verified |
| CAT-03 | Pending | ✅ Verified |
| CAT-04 | Pending | ✅ Verified |
| CAT-05 | Pending | ✅ Verified |
| CAT-06 | Pending | ✅ Verified |
| CAT-07 | Pending | ✅ Verified |
| CAT-08 | Pending | ✅ Verified |
| CAT-09 | Pending | ✅ Verified |
| CAT-10 | Pending | ✅ Verified |

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 7/7 P1 ACs + 3/3 P2 ACs covered with spec-matching assertions.
**Sensor**: 4/4 mutations killed.
**Gate**: lint, unit, build, and e2e all passed.

**What works**: local RabbitMQ lifecycle `RECEIVED → QUEUED → COMPLETED`, duplicate/invalid event handling, publication-failure propagation, conditional observation endpoint, RabbitMQ health endpoint, Docker build, zero-lint build.

**Issues found**: The first negative observation endpoint assertion was too weak (unknown ID) and survived the controller-registration mutation. Fixed via T21 by using a known request ID.

**Next steps**: None for this feature.
