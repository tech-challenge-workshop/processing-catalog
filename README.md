# Processing Catalog

Processing Catalog owns the durable lifecycle of each FIAP X `ProcessingRequest`. It persists state, serves owner-scoped status queries, and reliably publishes integration events through a transactional outbox.

See [the service boundary](docs/service-boundary.md) for ownership, integrations, and explicit exclusions.

## Foundation scope

This repository intentionally contains no NestJS, PostgreSQL, RabbitMQ, or TypeORM implementation yet. The approved system architecture is in the `fiap-x-platform` repository's `docs/foudation.md`.

## Database

**A database is required for the integrated flow.** When `DATABASE_HOST` is
unset the service still starts, but the composition root selects an in-memory
repository and an in-memory outbox with no relay behind it: transitions are
applied, events are recorded, and nothing ever reaches the broker. Downstream
services simply never hear from this one, and every health check stays green
while it happens.

That mode exists for tests that mean to exercise it, and those suites pin the
choice explicitly rather than inheriting it from the environment. Anything
resembling a running system - the Compose stack, Kubernetes, a manual trial -
must set `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_SCHEMA`,
`DATABASE_USER` and `DATABASE_PASSWORD`. `test/composition.e2e-spec.ts` asserts
which implementations the composition root selects in each case, because this
wiring once existed complete and unreferenced while 36 tests passed.

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
