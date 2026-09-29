# Processing Catalog roadmap

What has been delivered in this repository, slice by slice, and what is still open. The slices are cross-repository; the platform's [README](https://github.com/tech-challenge-workshop/fiap-x-platform) describes the whole system, and each slice's spec is under [`.specs/features/`](../.specs/features/).

## Delivered

Dates are merge dates on `main`.

| Slice | What it gave the Catalog | Merged |
| --- | --- | --- |
| Foundation | Repository, NestJS app, the aggregate in `RECEIVED`, in-memory adapters, then RabbitMQ consumers and events for a local Docker run | 2026-08-25 to 08-28, direct commits |
| Local-first stack | Managed-cloud coupling dropped from the tech context (AD-005) | #1, 2026-09-19 |
| S1 · CI | `quality` job: lint, typecheck, unit and e2e tests, build | #2, 2026-09-20 |
| S2 · Lifecycle | `PROCESSING` and `FAILED` reachable; the full state machine and terminal events | #4, 2026-09-21 |
| S3 · Persistence | TypeORM on PostgreSQL, migrations at boot, `processed_event` deduplication, transactional outbox and relay (AD-009, AD-010) | #5, 2026-09-21 |
| Pre-S4 hardening | Lifecycle events under a row lock and in any order; e2e against PostgreSQL in CI; failures classified for the DLQ (AD-012, AD-013) | #6, 2026-09-25 |
| S5 · Owner scope | Owner-scoped reads and their index (AUTH-10..13) | #7, 2026-09-26 |
| S6 · Upload and download | Idempotent create (`201`/`200`/`409`) and the archive key for downloads (UPL-11..14) | #8, 2026-09-26 |
| Spec B · API hardening | One request per upload (unique owner and source), `400` on malformed create (HARD-09..11) | #9, 2026-09-26 |
| Spec A · Messaging hardening | One relay drainer at a time, publish confirm timeout, attempt-safe lifecycle, e2e on their own database (MSG-01..09) | #10, 2026-09-26 |
| Spec F · Robustness | Publish-timeout floor, one `attemptId` rule for the three attempt events, lock and order pinned by tests (ROB-01..03) | #11, 2026-09-27 |
| S7 · Email | `ownerEmail` stored and carried on the terminal event only (RF-5, AD-015) | #12, 2026-09-28 |
| S8 · Observability | Correlation id stored and put on every event, JSON logs with redaction, outbox and consumer metrics (AD-016, AD-017) | #13, 2026-09-29 |
| S9a · Kubernetes | Multi-arch image published to GHCR on every merge to `main`, run by the kind cluster (AD-018) | #14, 2026-09-29 |

## Open items

From the verification record kept alongside the project ("Validar depois"). None blocks the delivered flow.

- **V56**: `OUTBOX_PUBLISH_TIMEOUT_MS` has no ceiling and accepts fractions. Node turns a delay above 2147483647 ms, or `0.4`, into 1 ms, so every publish times out and is republished each tick. Fix: require an integer with a ceiling (for example 60000 ms).
- **V62**: `npm run migration:run` fails because `data-source.ts` exports a factory, not a `DataSource` instance. Migrations at boot are unaffected.
- **V63**: a request that matches no controller is counted with `route="{/*splat}"` instead of `unmatched`.
- **V64**: audit two leaks the other services' verifiers found: `useLogger` in `main.ts` is not proven by a test that reads the app's real output, and an error's message or properties could carry an email or a storage key into a log line.
- **V65**: flaky test: `publishedFor` in `test/observability.e2e-spec.ts` drains the outbox once, and a drain that misses the advisory lock publishes nothing (about 1 run in 12).
- **V66**: the consumers write no log line per handled message, so a correlation id cannot be followed through the Catalog's logs beyond the HTTP access lines. Fix: one `info` line per message (event, result, `processingRequestId`).
- **V68**: the arm64 image build runs under QEMU and can hang until the job's 30-minute timeout, so a `:main` image can silently fail to publish. Fix: build each platform on a native runner and merge the manifests.
- **V73**: `GET /` still answers `Hello World!`; `RABBITMQ_QUEUES` declares three queues nothing publishes to (`video.validation.requested`, `processing.queued`, `processing.terminal`); the `EventPublisher` token is registered but never injected.
