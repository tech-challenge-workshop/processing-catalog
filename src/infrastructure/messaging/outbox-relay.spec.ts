import { DataSource } from 'typeorm';
import { catalogMetrics } from '../../observability/metrics';
import { RabbitMQConnection } from '../rabbitmq/rabbitmq.connection';
import { OutboxRelay, PendingOutboxRow } from './outbox-relay';

/**
 * A DataSource that answers the relay's queries from memory, so the metric
 * hooks are checked without a database. Row semantics are proven against
 * Postgres in test/outbox-relay.e2e-spec.ts.
 */
class FakeOutbox {
  locked = true;
  pending: PendingOutboxRow[] = [];
  oldestAge: number | null = null;
  readonly marked: string[] = [];

  readonly dataSource = {
    transaction: <T>(work: (manager: unknown) => Promise<T>) =>
      work({
        query: (sql: string, params: unknown[]) => this.inTx(sql, params),
      }),
    query: (sql: string) =>
      Promise.resolve(
        sql.includes('count(*)')
          ? [{ n: this.pending.length }]
          : [{ age: this.oldestAge }],
      ),
  } as unknown as DataSource;

  add(id: string): void {
    this.pending.push({
      id,
      queue: 'notification.terminal',
      pattern: 'terminal.event',
      payload: { eventId: id },
      created_at: new Date(),
    });
  }

  private inTx(sql: string, params: unknown[]): Promise<unknown> {
    if (sql.includes('pg_try_advisory_xact_lock')) {
      return Promise.resolve([{ locked: this.locked }]);
    }
    if (sql.includes('UPDATE outbox')) {
      const id = params[0] as string;
      this.marked.push(id);
      this.pending = this.pending.filter((row) => row.id !== id);
      return Promise.resolve([]);
    }
    return Promise.resolve([...this.pending]);
  }
}

describe('OutboxRelay metrics (OBS-23, OBS-24)', () => {
  let outbox: FakeOutbox;
  let send: jest.Mock<Promise<void>, [string, string, unknown]>;
  let relay: OutboxRelay;

  beforeEach(() => {
    catalogMetrics.resetMetrics();
    outbox = new FakeOutbox();
    send = jest.fn<Promise<void>, [string, string, unknown]>(() =>
      Promise.resolve(),
    );
    relay = new OutboxRelay(outbox.dataSource, {
      sendToQueue: send,
    } as unknown as RabbitMQConnection);
  });

  const failures = async () =>
    (await catalogMetrics.metrics())
      .split('\n')
      .find((line) => line.startsWith('fiapx_outbox_publish_failures_total '));

  it('counts a refused publish once and leaves the row pending', async () => {
    outbox.add('row-1');
    send.mockRejectedValueOnce(new Error('broker refused'));

    await expect(relay.drain()).rejects.toThrow('broker refused');

    expect(await failures()).toBe('fiapx_outbox_publish_failures_total 1');
    expect(outbox.pending.map((row) => row.id)).toEqual(['row-1']);
    expect(outbox.marked).toEqual([]);
  });

  it('counts a confirm timeout once per failed attempt, not once per pending row', async () => {
    outbox.add('row-1');
    outbox.add('row-2');
    outbox.add('row-3');
    send.mockRejectedValue(new Error('publish confirm timed out'));

    await expect(relay.drain()).rejects.toThrow();
    expect(await failures()).toBe('fiapx_outbox_publish_failures_total 1');

    await expect(relay.drain()).rejects.toThrow();
    expect(await failures()).toBe('fiapx_outbox_publish_failures_total 2');
    expect(outbox.pending).toHaveLength(3);
  });

  it('counts nothing when every row is confirmed, or when another replica holds the lock', async () => {
    outbox.add('row-1');
    expect(await relay.drain()).toBe(1);

    outbox.add('row-2');
    outbox.locked = false;
    expect(await relay.drain()).toBe(0);

    expect(await failures()).toBe('fiapx_outbox_publish_failures_total 0');
  });

  it('feeds the outbox gauges from its own pending queries once initialised', async () => {
    outbox.add('row-1');
    outbox.add('row-2');
    outbox.oldestAge = 17;

    relay.onModuleInit();
    const exposition = await catalogMetrics.metrics();

    expect(exposition).toContain('fiapx_outbox_pending_rows 2');
    expect(exposition).toContain('fiapx_outbox_oldest_pending_seconds 17');
  });

  it('reports an empty outbox as 0 pending rows aged 0 seconds', async () => {
    outbox.oldestAge = null;

    relay.onModuleInit();
    const exposition = await catalogMetrics.metrics();

    expect(exposition).toContain('fiapx_outbox_pending_rows 0');
    expect(exposition).toContain('fiapx_outbox_oldest_pending_seconds 0');
  });

  it('reflects a drain on the next scrape', async () => {
    outbox.add('row-1');
    outbox.oldestAge = 5;
    relay.onModuleInit();
    expect(await catalogMetrics.metrics()).toContain(
      'fiapx_outbox_pending_rows 1',
    );

    await relay.drain();
    outbox.oldestAge = null;

    const exposition = await catalogMetrics.metrics();
    expect(exposition).toContain('fiapx_outbox_pending_rows 0');
    expect(exposition).toContain('fiapx_outbox_oldest_pending_seconds 0');
  });
});
