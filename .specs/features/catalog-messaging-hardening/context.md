# Catalog Messaging Hardening — Context

Decisions captured on 2026-09-26, before Specify.

This feature is **spec A** of the plan that resolves the gap analysis's "Validar depois" section. The plan runs B → C → A → D; B (`api-hardening`) and C (`platform-gate-hardening`) are merged. It spans three repositories on the branch `fix/catalog-messaging-hardening`, one spec file each:

- `processing-catalog` (this file lives here)
- `notification-service`
- `processing-worker`

## Scope decided

| Item | Where | Decision |
| --- | --- | --- |
| V5: relay publishes a batch twice across replicas; relay hangs when the broker is away | Catalog | In |
| V7: invalid transitions accepted; `attemptId` never compared | Catalog | In |
| V13: `RABBITMQ_RETRY_BACKOFF_MS=""` becomes 0 ms | Catalog | In |
| e2e suites leave pending outbox rows in the stack's database | Catalog | In |
| V38: an oversized `sourceStorageKey` is a `500` under the unique index | Catalog | In (added by the user; left over from spec B) |
| V39: Catalog test gaps from spec B | Catalog | In (added by the user) |
| Notification requeues transient failures with no pause (AD-012) | Notification | In |
| V19: four Worker follow-ups | Worker | In |

## Gray areas resolved

| Question | Answer |
| --- | --- |
| An event from an older attempt (`attemptId` differs from the request's current one) for `ProcessingStarted`, `ProcessingCompleted` or `ProcessingFailed` | **Ignore without error.** Record the event as processed, change nothing, publish nothing. This is the same kind of no-op as AD-013: a redelivered old attempt is expected, not a malformed message |
| Invalid transitions (`VideoRejected` while `QUEUED`; `ProcessingFailed` while `RECEIVED`) | **Domain error → DLQ.** The consumer rejects without requeue (AD-012), and the request keeps its state |
| Isolating the e2e suites' outbox rows | **A dedicated test database** (`fiapx_e2e`) created by the test setup. The stack's `fiapx` database never receives test rows |

## Agent's discretion

- **How the relay avoids double publication across replicas:** row locks with `SKIP LOCKED`, or a single drainer via an advisory lock. Either way, per-request order must survive.
- **The publish timeout's default.**
- **Where the Worker's broker-level follow-ups are proven:** the Worker's own e2e suite against a real RabbitMQ, since the platform smoke is not in this feature.

## Deferred

- V40 and V41 (API tests and lint), and V42–V44 (platform): other repositories, not part of this plan's step A.
