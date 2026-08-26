# Processing Catalog roadmap specification

## Outcome

Deliver the durable source of truth for `ProcessingRequest`, including lifecycle state, owner-scoped queries, and reliable event publication.

## Delivery phases

1. **Bootstrap and quality**: restore dependencies, make Nest gates green, and establish CI.
2. **Domain model**: implement `ProcessingRequest`, the `RECEIVED -> QUEUED -> PROCESSING -> COMPLETED` state machine, terminal failure rules, and idempotent event handling.
3. **Persistence**: create PostgreSQL migrations, repository adapters, and the transactional outbox.
4. **Integration contracts**: version validation, processing, and terminal RabbitMQ events; publish only after durable persistence.
5. **Queries and operations**: expose owner-scoped status queries, outbox retry/monitoring, tests, telemetry, and containerization.

## Acceptance boundaries

- Only this service validates and persists Processing Request transitions.
- No binary data is stored in PostgreSQL and no other service shares its tables.
- A technical redelivery never creates a new business attempt or repeated state effect.

## Done

WHEN a valid processing event is consumed THEN the Catalog SHALL persist exactly one permitted state transition and publish its required integration event through the transactional outbox.
