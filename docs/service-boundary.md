# Processing Catalog service boundary

The Catalog is the source of truth for every `ProcessingRequest`: the only service that decides and persists its state. This page is its contract with the rest of the system; the mechanics are in the [README](../README.md).

## Owns

- The `ProcessingRequest` aggregate and its state machine, `RECEIVED -> QUEUED -> (PROCESSING) -> COMPLETED | FAILED` ([README, State machine](../README.md#state-machine)).
- Idempotent creation: one request per owner and idempotency key, and one request per owner and source.
- The `catalog` schema in PostgreSQL, and the transactional outbox that is its only way to publish.
- Owner-scoped reads for the API, and the ZIP key of a completed request.
- The owner's email once the API hands it over, and the correlation id stored with the request (AD-015, AD-016).
- The user-facing failure sentence, derived from the stored `failureCode` and never persisted.

## Does not own

- Authentication, presigned URLs or any binary: the API validates the JWT and passes the owner; the Catalog trusts it.
- FFprobe, FFmpeg, the ZIP and object storage: `processing-worker`. The Catalog stores keys, never bytes.
- Email and delivery records: `notification-service`.
- Queue arguments, dead-lettering and delivery limits: the platform's broker definitions and policy (AD-011, AD-012).

## Interfaces

**Inbound HTTP**, called only by `fiap-x-api`: `POST /processing-requests` (`ownerUserId`, `ownerEmail`, `sourceStorageKey`, `idempotencyKey`, optional `correlationId`; `201`, `200` replay, `400`, `409`), `GET /owners/:ownerUserId/processing-requests[/:id[/archive]]`. Plus `/health`, `/health/live`, `/metrics`, and the unscoped `GET /processing-requests/:id` only when `LOCAL_INTEGRATION=true`. Details: [README, HTTP API](../README.md#http-api).

**Outbound events**, JSON Nest envelopes published to the default exchange, straight to the queue:

| Event | Queue | Payload highlights |
| --- | --- | --- |
| `VideoValidationRequested` | `video-validation` | `eventId`, `processingRequestId`, `ownerUserId`, `sourceStorageKey`, `occurredAt` |
| `ProcessingQueued` | `processing` | the above plus `attemptId` |
| `terminal.event` | `notification.terminal` | `status`, `ownerUserId`, `ownerEmail`, `attemptId` when there was one, `zipStorageKey` or `failureReason` |

**Inbound events** from the Worker: `VideoAccepted` (`video.accepted`), `VideoRejected` (`video.rejected`), `ProcessingStarted` (`processing.started`), `ProcessingCompleted` (`processing.completed`), `ProcessingFailed` (`processing.failed`). Every event, both ways, may carry `correlationId`. There is no version field: each service keeps its own DTOs of the same JSON (AD-003), and new fields are added as optional ([README, Messaging](../README.md#messaging)).

## Data

Schema `catalog`, under its own role, no table shared with anyone (AD-009): `processing_request`, `processed_event` (deduplication by `eventId`) and `outbox`. Migrations run at boot; `synchronize` is never on ([README, Persistence](../README.md#persistence)).

## Invariants

- A transition, its `processed_event` row and the events it emits commit in one transaction; only the outbox relay publishes, and marks a row sent only after the broker confirms (AD-010). Delivery is at-least-once, never lost.
- An event is applied under a row lock; a redelivered `eventId` changes nothing (AD-013).
- Attempt events must carry a non-blank `attemptId`; one from an earlier attempt is recorded and ignored.
- A completion can overtake its start; a late start, or a completion restating the stored ZIP key, is a no-op that publishes nothing.
- `ownerEmail` travels only on the terminal event, so the Worker never sees it (AD-015).
- Every owner read filters on the owner in SQL, and the answer carries no source key.

## Failure policy

- Broker down: transitions still commit; rows stay pending and the relay retries every `OUTBOX_POLL_INTERVAL_MS`, one replica at a time (advisory lock), each publish bounded by `OUTBOX_PUBLISH_TIMEOUT_MS`.
- A consumed message that breaks a domain rule or is not JSON: `nack` without requeue, to `<queue>.dlq`. Anything else (the database away): requeued after `RABBITMQ_RETRY_BACKOFF_MS` (AD-012).
- No business retry: a failed validation or processing ends the request in `FAILED`.

## Decisions that bind it

AD-001, AD-003, AD-008 (no cache tier), AD-009 (schema per service, migrations only), AD-010 (outbox), AD-011 and AD-012 (broker-owned topology, classify then settle), AD-013 (row lock, order tolerance), AD-015, AD-016, AD-017 (logs, redaction, metrics) and AD-018 (image on GHCR, run by the kind cluster). The log is [`fiap-x-platform/.specs/STATE.md`](https://github.com/tech-challenge-workshop/fiap-x-platform/blob/main/.specs/STATE.md).
