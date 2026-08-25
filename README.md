# Processing Catalog

Processing Catalog owns the durable lifecycle of each FIAP X `ProcessingRequest`. It persists state, serves owner-scoped status queries, and reliably publishes integration events through a transactional outbox.

See [the service boundary](docs/service-boundary.md) for ownership, integrations, and explicit exclusions.

## Foundation scope

This repository intentionally contains no NestJS, PostgreSQL, RabbitMQ, or TypeORM implementation yet. The approved system architecture is in the workspace's `docs/foudation.md`.
