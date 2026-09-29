import { register } from 'prom-client';
import { CatalogMetrics, OutboxGaugeSource } from './metrics';

describe('CatalogMetrics', () => {
  let metrics: CatalogMetrics;

  beforeEach(() => {
    metrics = new CatalogMetrics();
  });

  interface FakeOutbox extends OutboxGaugeSource {
    pending: number;
    oldest: number | null;
  }

  const source = (pending: number, oldest: number | null): FakeOutbox => {
    const fake: FakeOutbox = {
      pending,
      oldest,
      pendingCount: () => Promise.resolve(fake.pending),
      oldestPendingAgeSeconds: () => Promise.resolve(fake.oldest),
    };
    return fake;
  };

  it('counts each outbox publish failure (OBS-24)', async () => {
    metrics.recordOutboxPublishFailure();
    metrics.recordOutboxPublishFailure();

    expect(await metrics.metrics()).toContain(
      'fiapx_outbox_publish_failures_total 2',
    );
  });

  it('counts consumed events by event and outcome, acked apart from dead-lettered (OBS-25)', async () => {
    metrics.recordEventConsumed('VideoAccepted', 'acked');
    metrics.recordEventConsumed('VideoAccepted', 'acked');
    metrics.recordEventConsumed('ProcessingFailed', 'dead_lettered');

    const exposition = await metrics.metrics();
    expect(exposition).toContain(
      'fiapx_events_consumed_total{event="VideoAccepted",outcome="acked"} 2',
    );
    expect(exposition).toContain(
      'fiapx_events_consumed_total{event="ProcessingFailed",outcome="dead_lettered"} 1',
    );
    expect(exposition).not.toContain(
      'fiapx_events_consumed_total{event="VideoAccepted",outcome="dead_lettered"}',
    );
  });

  it('reads the outbox gauges from the source at scrape time (OBS-23)', async () => {
    const outbox = source(3, 42);
    metrics.setOutboxSource(outbox);

    let exposition = await metrics.metrics();
    expect(exposition).toContain('fiapx_outbox_pending_rows 3');
    expect(exposition).toContain('fiapx_outbox_oldest_pending_seconds 42');

    outbox.pending = 0;
    outbox.oldest = null;
    exposition = await metrics.metrics();
    expect(exposition).toContain('fiapx_outbox_pending_rows 0');
    // An empty outbox has no oldest row: reported as 0, never NaN.
    expect(exposition).toContain('fiapx_outbox_oldest_pending_seconds 0');
  });

  it('keeps serving the last gauge values when the source fails (database down)', async () => {
    const outbox = source(5, 30);
    metrics.setOutboxSource(outbox);
    await metrics.metrics();

    outbox.pendingCount = () => Promise.reject(new Error('db down'));
    outbox.oldestPendingAgeSeconds = () => Promise.reject(new Error('db down'));

    const exposition = await metrics.metrics();
    expect(exposition).toContain('fiapx_outbox_pending_rows 5');
    expect(exposition).toContain('fiapx_outbox_oldest_pending_seconds 30');
  });

  it('records one http count and duration series per request', async () => {
    metrics.recordHttpRequest('GET', '/health', '200', 0.01);

    const exposition = await metrics.metrics();
    expect(exposition).toContain(
      'fiapx_http_requests_total{method="GET",route="/health",status="200"} 1',
    );
    expect(exposition).toContain(
      'fiapx_http_request_duration_seconds_count{method="GET",route="/health",status="200"} 1',
    );
  });

  it('keeps every family on its own registry and resets without duplicate registration', async () => {
    metrics.recordOutboxPublishFailure();
    metrics.recordEventConsumed('VideoRejected', 'acked');

    expect(await register.metrics()).not.toContain('fiapx_');
    expect(() => new CatalogMetrics()).not.toThrow();

    metrics.resetMetrics();
    const exposition = await metrics.metrics();
    expect(exposition).toContain('fiapx_outbox_publish_failures_total 0');
    expect(exposition).not.toContain('event="VideoRejected"');
    for (const family of [
      'fiapx_outbox_pending_rows',
      'fiapx_outbox_oldest_pending_seconds',
      'fiapx_outbox_publish_failures_total',
      'fiapx_events_consumed_total',
      'fiapx_http_requests_total',
    ]) {
      expect(exposition).toContain(`# TYPE ${family}`);
    }
  });
});
