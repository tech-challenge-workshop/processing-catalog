# Processing Catalog

Processing Catalog owns the durable lifecycle of each FIAP X `ProcessingRequest`. It persists state, serves owner-scoped status queries, and reliably publishes integration events through a transactional outbox.

See [the service boundary](docs/service-boundary.md) for ownership, integrations, and explicit exclusions.

## Foundation scope

This repository intentionally contains no NestJS, PostgreSQL, RabbitMQ, or TypeORM implementation yet. The approved system architecture is in the `fiap-x-platform` repository's `docs/foudation.md`.

## Database

This service owns the `catalog` schema: `processing_request`, `processed_event`
and `outbox`. It shares a PostgreSQL server with the Notification Service but
no tables, and each role is denied the other's schema.

Migrations are the only way the schema changes - `synchronize` is off, so a
running service can never reshape a table under itself. They are applied at
startup, and can be run by hand:

```sh
npm run migration:run
```

Applying them twice makes no change on the second run.

The consolidated creation script the challenge asks for as a deliverable is
**generated from these migrations** in `fiap-x-platform`, not maintained here.
A script written beside migrations drifts from them, and the drift stays
invisible until someone runs it.

### Why a transactional outbox

A state transition and the event announcing it are one business fact. They are
written in the same transaction, and a relay publishes pending rows and marks
them sent only after the broker confirms. If the broker is unreachable the
transition still commits and the event waits; nothing is lost.

Delivery is therefore at-least-once: a crash between the confirm and the mark
republishes a row. Every consumer deduplicates by `eventId`, so a repeat is
absorbed - and losing an event is the worse failure.
