# Processing Catalog service boundary

## Owns

- The `ProcessingRequest` aggregate, its state machine, and idempotent state transitions.
- PostgreSQL persistence for requests, metadata, and the transactional outbox.
- Owner-scoped processing-status queries.
- Reliable publication of versioned RabbitMQ validation, processing, and terminal events.

## Primary technology context

NestJS and TypeScript, PostgreSQL, and RabbitMQ.

## Integrations

- Receives request creation and status-query calls from FIAP X API.
- Publishes and consumes versioned RabbitMQ events through its outbox and idempotent consumers.
- Coordinates with Processing Worker through validation and processing outcome events.
- Publishes terminal events consumed by Notification Service.

## Does not own

- HTTP JWT validation, presigned storage URL generation, or direct binary transfer.
- FFprobe/FFmpeg execution, frame extraction, ZIP creation, or binary object storage.
- Email sending and notification delivery records.
- Database tables owned by any other service.

## Source of truth

This foundation reflects `docs/foudation.md` and the reference documents in the `fiap-x-platform` repository. It is not a product implementation.
