# Service Robustness Design — catalog

**Spec**: `.specs/features/service-robustness/spec.md`
**Context**: `.specs/features/service-robustness/context.md`
**Status**: Draft

---

## Architecture Overview

Three small, local changes. No new component. The design conforms to AD-010, AD-012 and AD-013, and applies the confirmed lesson L-005 and the candidate lessons L-008 to L-010.

| Change | File | What |
| --- | --- | --- |
| Timeout floor (ROB-01) | `src/infrastructure/rabbitmq/rabbitmq.connection.ts` | `outboxPublishTimeoutMs()` keeps the blank and non-numeric rules and maps `<= 0` to 5000. It stops reusing `parseNonNegativeMs`, whose "0 is valid" rule is right for a backoff and wrong for a timeout. The new rule is `parsePositiveMs(raw, fallback)` |
| One `attemptId` rule (ROB-02) | `src/infrastructure/rabbitmq/attempt-id.ts` (new) | `isValidAttemptId(value): value is string` accepts only a non-blank string. The Started, Completed and Failed consumers call it before the use case. When it fails they throw `ProcessingRequestDomainError('attemptId is required')`, which the existing classification sends to the DLQ. Completed's local `hasAttemptId` is removed |
| Pins (ROB-03) | tests + spec note + comment | See below |

---

## Components

### `parsePositiveMs` / `outboxPublishTimeoutMs`

- `parsePositiveMs(raw, fallback)` returns `fallback` when `raw` is any of:
  - undefined;
  - blank once trimmed;
  - not a finite number;
  - `<= 0`.

  Otherwise it returns the number.
- **Unit tests:** `"0"`, `"-5"`, `"  "`, `"abc"`, `"250"`.
- **Relay e2e:** set `OUTBOX_PUBLISH_TIMEOUT_MS=0` and point the real `RabbitMQConnection` at `amqp://127.0.0.1:1`. The drain must return within 7 s, and the row must stay pending.

### `isValidAttemptId`

- **In each consumer:** the payload guard becomes `if (!isValidAttemptId(payload.attemptId)) throw new ProcessingRequestDomainError('attemptId is required')`, and the consumer passes the value through without `String()`.
- **Unit tests, per consumer:**
  - `null`, `1`, `''` and `'  '` each give `nack(false)`, and the use case is never called;
  - a valid but different id gives the stale no-op (MSG-03).

### Pins

- **Lock release.** A new e2e case: relay A drains, rows are inserted, then relay B drains them on another DataSource, and B must publish them. This kills the mutant where the session lock is never released.
- **Fail order.** A unit test in which the Fail use case's under-lock dedup check runs before the stale check. A stale `ProcessingFailed` whose `eventId` is already processed must return without calling `markEventProcessed` a second time. If the order is swapped, it is called twice and the test fails.
- **Spec note.** `catalog-messaging-hardening/spec.md`, MSG-03 AC1, gains: "A `RECEIVED` request has no attempt yet and is never stale; MSG-05 governs it."
- **Comment.** The `isUnchanged` doc comment moves back above `isUnchanged` in `src/domain/processing-request.ts`.

---

## Risks & Concerns

| Concern | Impact | Mitigation |
| --- | --- | --- |
| Rejecting `attemptId: 1` changes behaviour for a numeric id | A Worker that sent numbers would now go to the DLQ | The Worker sends UUID strings, and the spec's edge case pins the rule |
| The 7 s timeout e2e is slow | The suite takes about 5 s more | Only this one case uses the default; every other case injects a short positive timeout |
