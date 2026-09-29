import { Counter, Gauge, Histogram, Registry } from 'prom-client';

const HTTP_LABELS = ['method', 'route', 'status'] as const;

/** The events the Catalog consumes; the only values the `event` label takes. */
export type ConsumedEventName =
  | 'VideoAccepted'
  | 'VideoRejected'
  | 'ProcessingStarted'
  | 'ProcessingCompleted'
  | 'ProcessingFailed';

/** How a consumed message was finally settled. A requeue is not final. */
export type ConsumedOutcome = 'acked' | 'dead_lettered';

/** What the outbox gauges read at scrape time: the relay's own queries. */
export interface OutboxGaugeSource {
  pendingCount(): Promise<number>;
  /** Seconds since the oldest pending row was recorded, or null when empty. */
  oldestPendingAgeSeconds(): Promise<number | null>;
}

/**
 * The Catalog's Prometheus metrics on a dedicated registry, never the
 * prom-client global, so per-app state holds and e2e suites stay isolated.
 * Call sites use the one process-wide instance; unit tests build their own.
 *
 * Labels are bounded (`event`, `outcome`, HTTP method/route/status): no
 * request ids, owner ids or emails.
 */
export class CatalogMetrics {
  private readonly registry = new Registry();
  private outboxSource: OutboxGaugeSource | undefined;

  private readonly outboxPendingRows = new Gauge({
    name: 'fiapx_outbox_pending_rows',
    help: 'Outbox rows recorded but not yet confirmed by the broker.',
    registers: [this.registry],
    collect: this.outboxCollector((source) => source.pendingCount()),
  });

  private readonly outboxOldestPendingSeconds = new Gauge({
    name: 'fiapx_outbox_oldest_pending_seconds',
    help: 'Age in seconds of the oldest pending outbox row; 0 when none is pending.',
    registers: [this.registry],
    collect: this.outboxCollector(
      async (source) => (await source.oldestPendingAgeSeconds()) ?? 0,
    ),
  });

  private readonly outboxPublishFailuresTotal = new Counter({
    name: 'fiapx_outbox_publish_failures_total',
    help: 'Outbox publish attempts refused by the broker or past the confirm timeout; the row stays pending.',
    registers: [this.registry],
  });

  private readonly eventsConsumedTotal = new Counter({
    name: 'fiapx_events_consumed_total',
    help: 'Consumed messages by event and final settlement.',
    labelNames: ['event', 'outcome'],
    registers: [this.registry],
  });

  private readonly httpRequestsTotal = new Counter({
    name: 'fiapx_http_requests_total',
    help: 'HTTP requests served, by method, route template, and status.',
    labelNames: [...HTTP_LABELS],
    registers: [this.registry],
  });

  private readonly httpRequestDuration = new Histogram({
    name: 'fiapx_http_request_duration_seconds',
    help: 'HTTP request duration in seconds, by method, route template, and status.',
    labelNames: [...HTTP_LABELS],
    registers: [this.registry],
  });

  /** Points the outbox gauges at the relay; read on every scrape. */
  setOutboxSource(source: OutboxGaugeSource): void {
    this.outboxSource = source;
  }

  recordOutboxPublishFailure(): void {
    this.outboxPublishFailuresTotal.inc();
  }

  recordEventConsumed(
    event: ConsumedEventName,
    outcome: ConsumedOutcome,
  ): void {
    this.eventsConsumedTotal.inc({ event, outcome });
  }

  recordHttpRequest(
    method: string,
    route: string,
    status: string,
    durationSeconds: number,
  ): void {
    const labels = { method, route, status };
    this.httpRequestsTotal.inc(labels);
    this.httpRequestDuration.observe(labels, durationSeconds);
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }

  resetMetrics(): void {
    this.registry.resetMetrics();
  }

  /** prom-client calls a gauge's collect with the gauge as `this`. */
  private outboxCollector(
    read: (source: OutboxGaugeSource) => Promise<number>,
  ): (this: Gauge) => Promise<void> {
    const sourceOf = () => this.outboxSource;
    return async function (this: Gauge) {
      const source = sourceOf();
      if (!source) {
        return;
      }
      try {
        this.set(await read(source));
      } catch {
        // The database is away: keep the last value rather than fail the
        // scrape. /metrics must outlive its dependencies; /health reports them.
      }
    };
  }
}

export const catalogMetrics = new CatalogMetrics();
