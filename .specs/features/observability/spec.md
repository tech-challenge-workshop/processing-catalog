# Observability — Processing Catalog Specification

Part of S8 (observability and autoscale), split across 5 sibling specs (`fiap-x-api` OBS-01..15, `processing-catalog` OBS-16..30, `processing-worker` OBS-31..45, `notification-service` OBS-46..60, `fiap-x-platform` OBS-61..75). This repo's job: persist the `correlationId` that the API originates, propagate it on every published and consumed event, expose the outbox metrics the dashboard needs, and split health into readiness/liveness.

## Problem Statement

The Catalog owns the lifecycle and the transactional outbox, but emits no metrics: queue backpressure and outbox drain health are invisible until something breaks. Events and consumers carry no correlation id, so a request cannot be traced from the edge through the lifecycle. The existing `/health` already reports dependency state, but there is no liveness endpoint and no Prometheus exposition. The `foudation.md` already promises `/metrics` per service and lists the outbox failure metrics as part of the minimum set.

## Goals

- [ ] Every event the Catalog publishes (outbox-driven) and every message it consumes carries the pipeline's `correlationId`; consumers lacking one generate it.
- [ ] `GET /metrics` exposes the outbox gauges (`fiapx_outbox_pending_rows`, `fiapx_outbox_oldest_pending_seconds`), the publish-failure counter, and per-event consumption counters.
- [ ] Readiness (`/health`) reports not-ready when PostgreSQL or RabbitMQ is unreachable while liveness (`/health/live`) stays 200.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Changing the outbox relay algorithm | S8 observes the existing relay (S3/A/F); no behavior change |
| RabbitMQ queue-depth metrics | Provided by the broker's Prometheus plugin wired in `fiap-x-platform` |
| Distributed tracing (OpenTelemetry) | Optional per S8 scope |
| KEDA / horizontal autoscale | S9a |
| PII expansion via `correlationId` | The field is a trace id, not PII; AD-015's PII surface stays unchanged (the Worker still never sees an email) |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| correlationId transport | Contract field `correlationId` on every event DTO; nullable `processing_request.correlation_id` column (new migration); the create use case persists the value the API sends; lifecycle use cases copy it into the terminal event; other published events read it from the stored request; consumers set the log context from the incoming message and generate one when absent | Foundation doc promises propagation; mirrors the S7 `ownerEmail` pattern (persist once, carry on the event) | n (user skipped; default chosen — review at confirm) |
| Column shape | `correlation_id varchar(128) NULL`, validated non-blank printable-ASCII when present (≤ 128) | L-005: bound client-influenced values; matches the API's header bound |
| Outbox metrics source | Gauges read the existing `pendingCount()` / `oldestPendingAgeSeconds()` on the relay each scrape | They already exist and are unused today; no new query needed |
| Metric labels | Bounded only (`event`, `outcome`); no `processingRequestId`, owner ids, or emails as labels | Cardinality + AD-015 |
| Logs | `nestjs-pino` JSON with the message's `correlationId`; redaction covers AMQP credentials; `ownerEmail` continues to never appear in logs (S7 rule, now also enforced by redaction config) | Consistency with the other services |
| Readiness semantics | `/health` 503 + `{status, rabbitmq, database}` when a dependency is unreachable (existing behavior, kept), 200 otherwise; `/health/live` always 200 while the process serves | Gap-analysis seed criterion 3; worker already splits this way |
| Health/metrics endpoints | Unauthenticated; not access-logged | Scraping convention; noise |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: correlationId propagated through the lifecycle ⭐ MVP

**User Story**: As an operator, I want the Catalog to store the correlation id the API originated and carry it on every published and consumed event so that one upload traces cleanly through the lifecycle to the terminal event.

**Why P1**: Without it the propagated correlation chain breaks exactly at the service that owns the lifecycle.

**Acceptance Criteria**:

1. WHEN the create use case receives a `correlationId` THEN the Catalog SHALL validate it (non-blank, ≤ 128 printable-ASCII when present) and SHALL persist it on the processing request in the same transaction as the request row. <!-- event-driven -->
2. WHEN the Catalog publishes any event from the outbox THEN the event SHALL carry the stored request's `correlationId` when one exists. <!-- event-driven -->
3. WHEN the Catalog publishes the terminal event THEN it SHALL carry the stored `correlationId`. <!-- event-driven -->
4. WHEN any consumer handles a message THEN the consumer SHALL set the log correlation context from the message's `correlationId` before handling and SHALL restore/clear it afterwards. <!-- event-driven -->
5. IF an inbound message lacks a `correlationId` or carries an invalid one THEN the consumer SHALL generate a fresh id for its log context and SHALL NOT fail the message. <!-- unwanted-behavior -->
6. IF the create request carries an invalid `correlationId` THEN the Catalog SHALL respond 400 with the same field-error shape as the other bounded fields. <!-- unwanted-behavior -->
7. WHEN the Catalog emits any log line THEN it SHALL be JSON carrying `timestamp`, `level`, `msg`, `service`, and the current `correlationId`, and SHALL NOT contain the owner's email. <!-- event-driven -->

**Independent Test**: E2E against real Postgres: create a request with `correlationId: cat-1`, drive it to `COMPLETED`, assert the terminal event DTO carries `cat-1`; consume a message without the field and assert the consumer logs carry a generated id and the message is acked.

---

### P2: Outbox metrics and split health

**User Story**: As an operator, I want Prometheus gauges for outbox depth and age, publish-failure and consumption counters, and split readiness/liveness so that backpressure and broker/database outages are visible on the dashboard.

**Why P1**: The foundation's minimum metric set names outbox failures explicitly, and seed criterion 3 requires readiness to go not-ready on dependency loss.

**Acceptance Criteria**:

1. WHEN Prometheus scrapes `GET /metrics` THEN the response SHALL include `fiapx_outbox_pending_rows`, `fiapx_outbox_oldest_pending_seconds`, `fiapx_outbox_publish_failures_total`, and `fiapx_events_consumed_total{event,outcome="acked|dead_lettered"}`. <!-- event-driven -->
2. WHEN a publish attempt exceeds the confirm timeout or the broker rejects it THEN the relay SHALL increment `fiapx_outbox_publish_failures_total` and SHALL leave the row pending. <!-- event-driven -->
3. WHEN a consumer settles a message THEN it SHALL increment `fiapx_events_consumed_total` with the matching `event` and `outcome`. <!-- event-driven -->
4. WHILE RabbitMQ or PostgreSQL is unreachable THEN `GET /health` SHALL respond 503 naming the failed dependency, and `GET /health/live` SHALL still respond 200. <!-- state-driven -->
5. WHEN both dependencies are healthy THEN `GET /health` SHALL respond 200. <!-- event-driven -->
6. The metric exposition and health endpoints SHALL NOT require authentication and SHALL NOT produce access-log lines. <!-- ubiquitous -->

**Independent Test**: With the broker stopped, `/health` returns 503 naming rabbitmq while `/health/live` returns 200; with pending outbox rows seeded, `/metrics` reports the matching `fiapx_outbox_pending_rows`.

---

## Edge Cases

- IF a stored request has `NULL correlation_id` THEN published events omit the field (DTO optional) and consumers of those events generate a fresh id (OBS-20).
- IF the scrape happens mid-relay-tick THEN the gauges reflect the last completed read, never a partial drain.
- IF the database is down THEN `/metrics` SHALL still respond 200 (registry values go stale) while `/health` reports 503 — scraping must not die with the dependency.
- WHEN `correlation_id` would exceed the btree-safe bound THEN validation rejects it at 400 before it reaches storage (L-005).

---

## Implicit-Requirement Dimensions Sweep

| Dimension | Resolution |
| --- | --- |
| Input validation & bounds | OBS-16/OBS-21 bound and validate `correlationId` |
| Failure / partial-failure | Publish failures counted, rows stay pending (OBS-23); metrics stay up when DB is down |
| Idempotency / retry / duplicate | Unchanged — existing dedup/lock behavior observed, not modified |
| Auth boundaries | `/health`, `/health/live`, `/metrics` public by design |
| Concurrency / ordering | Advisory-lock relay unchanged; per-message correlation context is isolated across concurrent consumers |
| Data lifecycle / expiry | `correlation_id` persists with the request (historical traceability) |
| Observability | this feature |
| External-dependency failure | Seed criterion 3 codified as OBS-26 |
| State-transition integrity | N/A — no transition rules change; lifecycle use cases only copy an extra field onto events |

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| OBS-16 | P1: correlationId (persist) | Execute (T6, T7) | Implemented |
| OBS-17 | P1: correlationId (published events) | Execute (T7, T9) | Implemented |
| OBS-18 | P1: correlationId (terminal event) | Execute (T10, T11, T12) | Implemented |
| OBS-19 | P1: correlationId (consumer context) | Design | Pending |
| OBS-20 | P1: correlationId (fallback) | Design | Pending |
| OBS-21 | P1: correlationId (400 on invalid) | Execute (T7, T8) | Implemented |
| OBS-22 | P1: structured logs | Design | Pending |
| OBS-23 | P2: Metrics (exposition set) | Execute (T13) | In progress |
| OBS-24 | P2: Metrics (publish failures) | Execute (T13) | In progress |
| OBS-25 | P2: Metrics (consumed counter) | Execute (T13) | In progress |
| OBS-26 | P2: Health (not-ready on dependency loss) | Design | Pending |
| OBS-27 | P2: Health (ready when healthy) | Design | Pending |
| OBS-28 | P2: Health/Metrics (no auth, no noise) | Design | Pending |

**ID format:** `OBS-[NUMBER]` — `fiap-x-api` owns OBS-01..15; this repo owns OBS-16..30; `processing-worker` OBS-31..45; `notification-service` OBS-46..60; `fiap-x-platform` OBS-61..75.

**Coverage:** 13 total, 0 mapped to tasks, 13 unmapped (mapping happens in Tasks).

---

## Success Criteria

- [ ] A request created with `correlationId: cat-1` emits that id on every event the Catalog publishes for it, provable in an e2e against real Postgres.
- [ ] `/metrics` shows outbox gauges matching seeded pending rows and the consumption counters split acked vs dead-lettered.
- [ ] With the broker stopped: `/health` 503, `/health/live` 200, `/metrics` 200.
