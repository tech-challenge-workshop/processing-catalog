# Service Robustness Tasks — catalog

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.** (In this project's sessions the skill is not registered by name; the user has authorized reading it from `.agents/skills/tlc-spec-driven/` by path.)

---

**Design**: `.specs/features/service-robustness/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Same layers and commands as `catalog-messaging-hardening/tasks.md`. Confirm before Execute.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Config parsing | unit | Every input class, including `0` and negative values | `src/infrastructure/**/*.spec.ts` | `npm test` |
| Outbox relay | integration | A zero timeout still times out; the lock is released | `test/outbox-relay.e2e-spec.ts` | `DATABASE_HOST=localhost npm run test:e2e` |
| Consumers | unit | Each malformed `attemptId` gives `nack(false)` and never calls the use case; a valid stale id is a no-op | `src/infrastructure/rabbitmq/*.spec.ts` | `npm test` |
| Use case | unit | In Fail, dedup runs before the stale check | `src/application/*.spec.ts` | `npm test` |

## Gate Check Commands

> Port 5432 is taken on this machine: run PostgreSQL elsewhere, with the platform's `db/init` mounted, and set `DATABASE_PORT`. The suites use `fiapx_e2e`.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Unit-only tasks | `npm test` |
| Full | e2e tasks | `npm test && DATABASE_HOST=localhost npm run test:e2e` |
| Build | Last task | `npm run lint && npm run typecheck && npm test && DATABASE_HOST=localhost npm run test:e2e && npm run build` |

---

## Execution Plan

### Phase 1

```
T1
T2
T3
```

---

## Task Breakdown

### T1: A publish timeout of zero or less falls back to 5000

**What**: `parsePositiveMs`, used by `outboxPublishTimeoutMs`, with unit tests and the zero-timeout relay e2e.
**Where**: `src/infrastructure/rabbitmq/rabbitmq.connection.ts`
**Depends on**: None
**Reuses**: `parseNonNegativeMs`'s shape
**Requirement**: ROB-01

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Unit: `"0"` → 5000, `"-5"` → 5000, `"  "` → 5000, `"abc"` → 5000, `"250"` → 250. The `"0"` case is seen red first
- [x] e2e: with `OUTBOX_PUBLISH_TIMEOUT_MS=0` and an unreachable broker, the drain returns within 7 s and the row stays pending
- [x] The backoff's `"0"` → 0 is unchanged
- [x] Full gate passes

**Tests**: unit + integration
**Gate**: full

**Status**: ✅ Complete. `parsePositiveMs(raw, fallback)` in `rabbitmq.connection.ts` backs `outboxPublishTimeoutMs()`. The existing unit case `"0"` → 0 was changed to `"0"` → 5000 (the spec reverses it) and `"-5"` was added; seen red first on `"0"`. New relay e2e with `OUTBOX_PUBLISH_TIMEOUT_MS=0` and the real `RabbitMQConnection` at `amqp://127.0.0.1:1`: seen red (hung past 15 s), then rejects after ~5 s with the row pending. The backoff's `"0"` → 0 stays pinned in `settle-failed-message.spec.ts`. Full gate: 230 unit (229 + 1), 172 e2e (171 + 1), 0 skipped.

---

### T2: One `attemptId` rule for every attempt consumer

**What**: `isValidAttemptId` in a new module, used by the Started, Completed and Failed consumers, which drop their `String()` conversion.
**Where**: `src/infrastructure/rabbitmq/attempt-id.ts` (+ the three consumers)
**Depends on**: None
**Reuses**: Completed's `hasAttemptId`
**Requirement**: ROB-02

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] In each consumer, `null`, `1`, `''` and `'  '` each give `nack(false)` without calling the use case, and a valid different id gives the stale no-op. Started and Failed are seen red first
- [x] Putting the presence-only check back on Failed fails its test
- [x] Quick gate passes

**Tests**: unit
**Gate**: quick

**Status**: ✅ Complete. New `src/infrastructure/rabbitmq/attempt-id.ts` (`isValidAttemptId`); the three consumers throw `ProcessingRequestDomainError('attemptId is required')` before the use case and pass the value through without `String()`; Completed's `hasAttemptId` is gone. Tests per consumer: missing, `null`, `1`, `''`, `'  '` → `nack(false)` with no use-case call and the state kept, plus a valid different id → ack with the state kept (stale no-op). Seen red first: Started and Failed (all five cases); Completed only on the error message (it already rejected these values) and on the new `1` case's message. The existing Completed table now expects `'attemptId is required'` instead of `'Invalid ProcessingCompleted payload'` and gained the `1` case. The stale cases were green before the change, as MSG-03 is unchanged. Negative: the presence-only check with `String()` back on Failed turns 4 cases red (`null`, `1`, `''`, `'  '`). Quick gate: 244 unit (230 + 14), 0 skipped.

---

### T3: Pin the lock release and Fail order; write the exemption

**What**: Four pins:
- the lock-release e2e;
- the Fail dedup-before-stale unit test;
- the MSG-03 note in `catalog-messaging-hardening/spec.md`;
- the `isUnchanged` comment moved back above its function.

**Where**: `test/outbox-relay.e2e-spec.ts` (+ `src/application/fail-processing-request.use-case.spec.ts`, the spec note, `src/domain/processing-request.ts`)
**Depends on**: None
**Reuses**: The two-relay harness
**Requirement**: ROB-03

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] A session lock that is never released fails the lock-release test (M01b)
- [ ] Swapping the order in Fail fails the order test (M05d)
- [ ] The spec note and the comment are in place
- [ ] Build gate passes

**Tests**: unit + integration
**Gate**: build

---

## Phase Execution Map

```
Phase 1 (T1 T2 T3)
```

3 tasks.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1 | 1 parser | ✅ Granular |
| T2 | 1 validator + 3 call sites | ⚠️ OK - cohesive; one rule applied everywhere |
| T3 | Tests + a note + a comment | ⚠️ OK - cohesive; V47's four pins |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows (within phase) | Status |
| --- | --- | --- | --- |
| T1 | None | — | ✅ Match |
| T2 | None | — | ✅ Match |
| T3 | None | — | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Config parsing + relay | unit + integration | unit + integration | ✅ OK |
| T2 | Consumers | unit | unit | ✅ OK |
| T3 | Relay + use case (tests) | unit + integration | unit + integration | ✅ OK |
