import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { createDataSource } from '../src/infrastructure/persistence/data-source';
import { OutboxRelay } from '../src/infrastructure/messaging/outbox-relay';
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
