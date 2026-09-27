import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { createDataSource } from '../src/infrastructure/persistence/data-source';
import {
  OUTBOX_RELAY_LOCK_KEY,
  OutboxRelay,
} from '../src/infrastructure/messaging/outbox-relay';
import { RabbitMQConnection } from '../src/infrastructure/rabbitmq/rabbitmq.connection';

const describeIfDatabase = process.env.DATABASE_HOST ? describe : describe.skip;

interface Sent {
  queue: string;
  pattern: string;
  payload: unknown;
}

class RecordingConnection {
  readonly sent: Sent[] = [];
  failNext = false;

  sendToQueue(queue: string, pattern: string, payload: unknown): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('broker unreachable'));
    }
    this.sent.push({ queue, pattern, payload });
    return Promise.resolve();
  }
}

describeIfDatabase('OutboxRelay', () => {
  let dataSource: DataSource;
  let connection: RecordingConnection;
  let relay: OutboxRelay;

  beforeAll(async () => {
    dataSource = createDataSource();
    await dataSource.initialize();
    await dataSource.runMigrations();
  }, 30_000);

  afterAll(async () => {
    await dataSource.destroy();
  }, 30_000);

  beforeEach(async () => {
    await dataSource.query('DELETE FROM outbox');
    connection = new RecordingConnection();
    relay = new OutboxRelay(
      dataSource,
      connection as unknown as RabbitMQConnection,
    );
  });

  const addPending = async (pattern = 'terminal.event') => {
    const eventId = randomUUID();
    await dataSource.query(
      `INSERT INTO outbox (queue, pattern, payload, created_at, published_at)
       VALUES ($1, $2, $3::jsonb, now(), NULL)`,
      ['notification.terminal', pattern, JSON.stringify({ eventId })],
    );
    return eventId;
  };

  it('publishes a pending row and only then marks it sent', async () => {
    const eventId = await addPending();

    const published = await relay.drain();

    expect(published).toBe(1);
    expect(connection.sent).toHaveLength(1);
    expect(connection.sent[0].queue).toBe('notification.terminal');
    expect(connection.sent[0].pattern).toBe('terminal.event');
    expect(connection.sent[0].payload).toEqual({ eventId });
    expect(await relay.pendingCount()).toBe(0);
  });

  it('leaves the row pending when the broker refuses it', async () => {
    await addPending();
    connection.failNext = true;

    await expect(relay.drain()).rejects.toThrow('broker unreachable');

    // Nothing was marked sent, so the event is not lost - it is retried.
    expect(await relay.pendingCount()).toBe(1);
    expect(connection.sent).toHaveLength(0);
  });

  it('publishes the row on a later poll once the broker returns', async () => {
    await addPending();
    connection.failNext = true;
    await expect(relay.drain()).rejects.toThrow();

    const published = await relay.drain();

    expect(published).toBe(1);
    expect(await relay.pendingCount()).toBe(0);
  });

  it('republishes a row whose mark did not land, which is why delivery is at-least-once', async () => {
    const eventId = await addPending();
    await relay.drain();
    // Simulate a crash between the broker confirming and the mark committing.
    await dataSource.query(
      `UPDATE outbox SET published_at = NULL WHERE payload->>'eventId' = $1`,
      [eventId],
    );

    await relay.drain();

    expect(connection.sent).toHaveLength(2);
    expect(connection.sent[0].payload).toEqual(connection.sent[1].payload);
  });

  it('does nothing when the outbox is empty', async () => {
    const published = await relay.drain();

    expect(published).toBe(0);
    expect(connection.sent).toHaveLength(0);
    expect(await relay.oldestPendingAgeSeconds()).toBeNull();
  });

  it('publishes in the order the rows were recorded', async () => {
    const first = await addPending('VideoValidationRequested');
    const second = await addPending('ProcessingQueued');

    await relay.drain();

    expect(connection.sent.map((s) => s.pattern)).toEqual([
      'VideoValidationRequested',
      'ProcessingQueued',
    ]);
    expect((connection.sent[0].payload as { eventId: string }).eventId).toBe(
      first,
    );
    expect((connection.sent[1].payload as { eventId: string }).eventId).toBe(
      second,
    );
  });

  it('exposes how many rows are pending and how old the oldest is', async () => {
    await addPending();
    await addPending();

    expect(await relay.pendingCount()).toBe(2);
    expect(await relay.oldestPendingAgeSeconds()).toBeGreaterThanOrEqual(0);
  });
});

interface Ordered {
  eventId: string;
  requestId: string;
  seq: number;
}

/** Records every publish; a short pause lets two drains overlap. */
class CountingConnection {
  readonly sent: Ordered[] = [];

  async sendToQueue(
    _queue: string,
    _pattern: string,
    payload: unknown,
  ): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 2));
    this.sent.push(payload as Ordered);
  }
}

/** Rejects the Nth publish (1-based), then behaves. */
class FailingOnNthConnection {
  readonly sent: Ordered[] = [];
  private calls = 0;

  constructor(private readonly failOn: number) {}

  sendToQueue(
    _queue: string,
    _pattern: string,
    payload: unknown,
  ): Promise<void> {
    this.calls += 1;
    if (this.calls === this.failOn) {
      return Promise.reject(new Error('timeout'));
    }
    this.sent.push(payload as Ordered);
    return Promise.resolve();
  }
}

describeIfDatabase('OutboxRelay across replicas and failures', () => {
  let dataSourceA: DataSource;
  let dataSourceB: DataSource;

  beforeAll(async () => {
    dataSourceA = createDataSource();
    await dataSourceA.initialize();
    await dataSourceA.runMigrations();
    dataSourceB = createDataSource();
    await dataSourceB.initialize();
  }, 30_000);

  afterAll(async () => {
    await dataSourceA.destroy();
    await dataSourceB.destroy();
  }, 30_000);

  beforeEach(async () => {
    await dataSourceA.query('DELETE FROM outbox');
  });

  /** Inserts `requests` x `perRequest` rows, interleaved across requests. */
  const addInterleaved = async (
    requests: number,
    perRequest: number,
  ): Promise<Ordered[]> => {
    const requestIds = Array.from({ length: requests }, () => randomUUID());
    const rows: Ordered[] = [];
    for (let seq = 0; seq < perRequest; seq += 1) {
      for (const requestId of requestIds) {
        const row = { eventId: randomUUID(), requestId, seq };
        await dataSourceA.query(
          `INSERT INTO outbox (queue, pattern, payload, created_at, published_at)
           VALUES ('processing.queued', 'Ordered', $1::jsonb, now(), NULL)`,
          [JSON.stringify(row)],
        );
        rows.push(row);
      }
    }
    return rows;
  };

  const pendingIds = async (): Promise<string[]> => {
    const rows: { eventId: string }[] = await dataSourceA.query(
      `SELECT payload->>'eventId' AS "eventId"
         FROM outbox WHERE published_at IS NULL ORDER BY id`,
    );
    return rows.map((r) => r.eventId);
  };

  it('publishes each row exactly once, in per-request order, when two relays drain together', async () => {
    const rows = await addInterleaved(10, 10);
    const publisher = new CountingConnection();
    const relayA = new OutboxRelay(
      dataSourceA,
      publisher as unknown as RabbitMQConnection,
    );
    const relayB = new OutboxRelay(
      dataSourceB,
      publisher as unknown as RabbitMQConnection,
    );

    for (
      let round = 0;
      round < 20 && (await pendingIds()).length > 0;
      round++
    ) {
      await Promise.all([relayA.drain(), relayB.drain()]);
    }

    const ids = publisher.sent.map((e) => e.eventId);
    expect(ids).toHaveLength(100);
    expect(new Set(ids).size).toBe(100);
    expect(new Set(ids)).toEqual(new Set(rows.map((r) => r.eventId)));
    for (const requestId of new Set(rows.map((r) => r.requestId))) {
      const seqs = publisher.sent
        .filter((e) => e.requestId === requestId)
        .map((e) => e.seq);
      expect(seqs).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    }
    expect(await pendingIds()).toEqual([]);
  }, 30_000);

  it('returns 0 and publishes nothing while another replica holds the relay lock', async () => {
    const [row] = await addInterleaved(1, 1);
    const publisher = new CountingConnection();
    const relay = new OutboxRelay(
      dataSourceA,
      publisher as unknown as RabbitMQConnection,
    );
    const holder = dataSourceB.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    try {
      await holder.query('SELECT pg_advisory_xact_lock($1)', [
        OUTBOX_RELAY_LOCK_KEY,
      ]);

      expect(await relay.drain()).toBe(0);
      expect(publisher.sent).toEqual([]);
      expect(await pendingIds()).toEqual([row.eventId]);
    } finally {
      await holder.rollbackTransaction();
      await holder.release();
    }
  });

  it('keeps the marks made before a failed publish, leaves the rest pending, and a later drain finishes them', async () => {
    const rows = await addInterleaved(1, 5);
    const publisher = new FailingOnNthConnection(3);
    const relay = new OutboxRelay(
      dataSourceA,
      publisher as unknown as RabbitMQConnection,
    );

    await expect(relay.drain()).rejects.toThrow('timeout');

    expect(publisher.sent.map((e) => e.eventId)).toEqual([
      rows[0].eventId,
      rows[1].eventId,
    ]);
    expect(await pendingIds()).toEqual(rows.slice(2).map((r) => r.eventId));

    expect(await relay.drain()).toBe(3);

    expect(publisher.sent.map((e) => e.eventId)).toEqual(
      rows.map((r) => r.eventId),
    );
    expect(await pendingIds()).toEqual([]);
  });

  describe('with a broker that never confirms', () => {
    const previousUrl = process.env.RABBITMQ_URL;
    const previousTimeout = process.env.OUTBOX_PUBLISH_TIMEOUT_MS;
    let connection: RabbitMQConnection;

    beforeEach(() => {
      // Nothing listens here, so the real channel wrapper buffers the publish
      // and never confirms it; only its timeout can end the wait.
      process.env.RABBITMQ_URL = 'amqp://127.0.0.1:1';
      process.env.OUTBOX_PUBLISH_TIMEOUT_MS = '300';
      connection = new RabbitMQConnection();
      connection.onModuleInit();
    });

    afterEach(async () => {
      await connection.onModuleDestroy();
      for (const [name, value] of [
        ['RABBITMQ_URL', previousUrl],
        ['OUTBOX_PUBLISH_TIMEOUT_MS', previousTimeout],
      ] as const) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    });

    it('returns within the publish timeout and leaves the row pending', async () => {
      const [row] = await addInterleaved(1, 1);
      const relay = new OutboxRelay(dataSourceA, connection);

      const started = Date.now();
      await expect(relay.drain()).rejects.toThrow('timeout');
      const elapsed = Date.now() - started;

      expect(elapsed).toBeGreaterThanOrEqual(250);
      expect(elapsed).toBeLessThan(2_000);
      expect(await pendingIds()).toEqual([row.eventId]);
    }, 10_000);

    it('still times out when the timeout is configured as 0, falling back to 5000 ms', async () => {
      // amqp-connection-manager reads a 0 timeout as "wait forever" (ROB-01).
      process.env.OUTBOX_PUBLISH_TIMEOUT_MS = '0';
      const [row] = await addInterleaved(1, 1);
      const relay = new OutboxRelay(dataSourceA, connection);

      const started = Date.now();
      await expect(relay.drain()).rejects.toThrow('timeout');
      const elapsed = Date.now() - started;

      expect(elapsed).toBeGreaterThanOrEqual(4_500);
      expect(elapsed).toBeLessThan(7_000);
      expect(await pendingIds()).toEqual([row.eventId]);
    }, 15_000);
  });
});
