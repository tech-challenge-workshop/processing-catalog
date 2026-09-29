// The slice is proven in the production composition, over PostgreSQL.
delete process.env.LOCAL_INTEGRATION;

import { randomUUID } from 'crypto';
import type { Server } from 'http';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { Logger as NestLogger } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AcceptProcessingRequestUseCase } from '../src/application/accept-processing-request.use-case';
import { OutboxRelay } from '../src/infrastructure/messaging/outbox-relay';
import { DATA_SOURCE } from '../src/infrastructure/persistence/data-source';
import { RabbitMQConnection } from '../src/infrastructure/rabbitmq/rabbitmq.connection';
import { catalogMetrics } from '../src/observability/metrics';

interface Sent {
  queue: string;
  pattern: string;
  payload: Record<string, unknown>;
}

type ConsumeHandler = (message: { content: Buffer } | null) => void;

/**
 * The broker, as far as the Catalog can tell: records what the relay
 * publishes, hands each consumer's callback to the test, and can refuse
 * publishes to keep outbox rows pending.
 */
class FakeBroker {
  readonly sent: Sent[] = [];
  readonly handlers = new Map<string, ConsumeHandler>();
  refuse = false;
  connected = true;
  readonly channel = {
    consume: (queue: string, handler: ConsumeHandler) => {
      this.handlers.set(queue, handler);
      return Promise.resolve({ consumerTag: queue });
    },
    ack: jest.fn(),
    nack: jest.fn(),
  };

  isConnected(): boolean {
    return this.connected;
  }
  sendToQueue(
    queue: string,
    pattern: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (this.refuse) {
      return Promise.reject(new Error('broker refused'));
    }
    this.sent.push({ queue, pattern, payload });
    return Promise.resolve();
  }
  getConsumeChannel() {
    return this.channel;
  }
  onModuleInit(): void {}
  onModuleDestroy(): Promise<void> {
    return Promise.resolve();
  }
}

// Pino writes through process.stdout only when the stream looks "tampered"
// (pino's hasBeenTampered check); otherwise it takes a raw fd destination no
// test can intercept. Mark it tampered at import time, before any app boots.
const stdoutStream = process.stdout as unknown as {
  write: (chunk: unknown, ...args: unknown[]) => boolean;
};
const stdoutPrototype = Object.getPrototypeOf(stdoutStream) as {
  write: (chunk: unknown, ...args: unknown[]) => boolean;
};
if (stdoutStream.write === stdoutPrototype.write) {
  const passthrough = stdoutStream.write.bind(process.stdout);
  stdoutStream.write = (chunk: unknown, ...args: unknown[]) =>
    passthrough(chunk, ...args);
}

/**
 * Keeps every chunk written to stdout while `fn` runs, polling up to two
 * seconds for `until` so pino's asynchronous flush cannot race the assertion.
 */
async function capturingLogs(
  fn: () => Promise<unknown>,
  until: (text: string) => boolean,
): Promise<Record<string, unknown>[]> {
  const chunks: string[] = [];
  const original = stdoutStream.write;
  stdoutStream.write = (chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    await fn();
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && !until(chunks.join(''))) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  } finally {
    stdoutStream.write = original;
  }
  return chunks
    .join('')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const describeIfDatabase = process.env.DATABASE_HOST ? describe : describe.skip;

describeIfDatabase('observability slice (e2e, PostgreSQL)', () => {
  let app: INestApplication;
  let broker: FakeBroker;
  let dataSource: DataSource;
  const savedLogLevel = process.env.LOG_LEVEL;
  const http = () => request(app.getHttpServer() as Server);

  beforeAll(() => {
    // Read when each app is created: log for real so lines can be asserted.
    process.env.LOG_LEVEL = 'info';
  });

  afterAll(() => {
    if (savedLogLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = savedLogLevel;
    }
  });

  beforeEach(async () => {
    catalogMetrics.resetMetrics();
    broker = new FakeBroker();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RabbitMQConnection)
      .useValue(broker)
      .compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    app.useLogger(app.get(Logger));
    await app.init();
    dataSource = app.get(DATA_SOURCE);
  }, 30_000);

  afterEach(async () => {
    await app.close();
  }, 30_000);

  const owner = () => `obs-${randomUUID()}`;
  const createBody = (ownerUserId: string) => ({
    ownerUserId,
    ownerEmail: `${ownerUserId}@fiapx.local`,
    sourceStorageKey: `sources/${ownerUserId}/a.mp4`,
    idempotencyKey: 'key-' + randomUUID(),
  });

  const create = async (extra: Record<string, unknown> = {}) => {
    const ownerUserId = owner();
    const res = await http()
      .post('/processing-requests')
      .send({ ...createBody(ownerUserId), ...extra });
    expect(res.status).toBe(201);
    return (res.body as { processingRequestId: string }).processingRequestId;
  };

  /** Hands one message to a consumer's real channel callback and waits for its settlement. */
  const deliver = async (queue: string, body: unknown) => {
    const settled = () =>
      broker.channel.ack.mock.calls.length +
      broker.channel.nack.mock.calls.length;
    const before = settled();
    broker.handlers.get(queue)!({
      content: Buffer.from(JSON.stringify(body)),
    });
    for (let i = 0; i < 200 && settled() === before; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(settled()).toBe(before + 1);
  };

  const attemptOf = async (id: string): Promise<string> => {
    const rows: { attempt_id: string }[] = await dataSource.query(
      `SELECT attempt_id FROM processing_request WHERE processing_request_id = $1`,
      [id],
    );
    return rows[0].attempt_id;
  };

  /** Everything the relay handed the broker for one request, in order. */
  const publishedFor = async (id: string) => {
    await app.get(OutboxRelay).drain();
    return broker.sent.filter((s) => s.payload.processingRequestId === id);
  };

  const metricsText = async () => (await http().get('/metrics')).text;

  describe('correlation chain (OBS-16..18)', () => {
    it('stores cat-1 and carries it on every event published for the request, through COMPLETED', async () => {
      const id = await create({ correlationId: 'cat-1' });

      await deliver('video.accepted', {
        pattern: 'VideoAccepted',
        data: {
          eventId: randomUUID(),
          processingRequestId: id,
          occurredAt: new Date().toISOString(),
          correlationId: 'cat-1',
        },
      });
      const attemptId = await attemptOf(id);
      await deliver('processing.started', {
        pattern: 'ProcessingStarted',
        data: {
          eventId: randomUUID(),
          processingRequestId: id,
          attemptId,
          occurredAt: new Date().toISOString(),
          correlationId: 'cat-1',
        },
      });
      await deliver('processing.completed', {
        pattern: 'ProcessingCompleted',
        data: {
          eventId: randomUUID(),
          processingRequestId: id,
          attemptId,
          zipStorageKey: `zips/${id}.zip`,
          occurredAt: new Date().toISOString(),
          correlationId: 'cat-1',
        },
      });

      const stored: { correlation_id: string | null; status: string }[] =
        await dataSource.query(
          `SELECT correlation_id, status FROM processing_request WHERE processing_request_id = $1`,
          [id],
        );
      expect(stored[0]).toEqual({
        correlation_id: 'cat-1',
        status: 'COMPLETED',
      });

      const published = await publishedFor(id);
      expect(published.map((s) => s.pattern)).toEqual([
        'VideoValidationRequested',
        'ProcessingQueued',
        'terminal.event',
      ]);
      expect(published.map((s) => s.payload.correlationId)).toEqual([
        'cat-1',
        'cat-1',
        'cat-1',
      ]);
      expect(published[2].payload.status).toBe('COMPLETED');
    });

    it('carries the stored id on the failure terminal event', async () => {
      const id = await create({ correlationId: 'cat-2' });

      // The consumer's own id differs: the event takes the stored one.
      await deliver('video.rejected', {
        eventId: randomUUID(),
        processingRequestId: id,
        failureCode: 'FORMATO_INVALIDO',
        occurredAt: new Date().toISOString(),
        correlationId: 'worker-side-id',
      });

      const terminal = (await publishedFor(id)).find(
        (s) => s.pattern === 'terminal.event',
      );
      expect(terminal?.payload.status).toBe('FAILED');
      expect(terminal?.payload.correlationId).toBe('cat-2');
    });

    it('stores NULL and omits the field, never null, on every event when the create carried no id', async () => {
      const id = await create();
      await deliver('video.accepted', {
        eventId: randomUUID(),
        processingRequestId: id,
        occurredAt: new Date().toISOString(),
      });

      const stored: { correlation_id: string | null }[] =
        await dataSource.query(
          `SELECT correlation_id FROM processing_request WHERE processing_request_id = $1`,
          [id],
        );
      expect(stored[0].correlation_id).toBeNull();

      const published = await publishedFor(id);
      expect(published.map((s) => s.pattern)).toEqual([
        'VideoValidationRequested',
        'ProcessingQueued',
      ]);
      for (const event of published) {
        expect(event.payload).not.toHaveProperty('correlationId');
      }
    });
  });

  describe('consumers (OBS-19, OBS-20, OBS-25)', () => {
    /** Logs one line from inside the use case, i.e. inside the consumer's scope. */
    const logFromHandling = () => {
      const useCase = app.get(AcceptProcessingRequestUseCase);
      const original = useCase.execute.bind(useCase);
      jest.spyOn(useCase, 'execute').mockImplementation((input) => {
        new NestLogger('VideoAcceptedHandling').log('handling VideoAccepted');
        return original(input);
      });
    };

    it('handles a message without a correlationId under a generated id and acks it', async () => {
      const id = await create();
      logFromHandling();

      const lines = await capturingLogs(
        () =>
          deliver('video.accepted', {
            eventId: randomUUID(),
            processingRequestId: id,
            occurredAt: new Date().toISOString(),
          }),
        (text) => text.includes('handling VideoAccepted'),
      );

      const handling = lines.find((l) => l.msg === 'handling VideoAccepted');
      expect(handling?.correlationId).toEqual(expect.stringMatching(UUID));
      expect(broker.channel.ack).toHaveBeenCalledTimes(1);
      expect(broker.channel.nack).not.toHaveBeenCalled();
    });

    it("logs the handling under the message's id and counts acked apart from dead-lettered", async () => {
      const id = await create();
      logFromHandling();

      const lines = await capturingLogs(
        () =>
          deliver('video.accepted', {
            pattern: 'VideoAccepted',
            data: {
              eventId: randomUUID(),
              processingRequestId: id,
              occurredAt: new Date().toISOString(),
              correlationId: 'cat-9',
            },
          }),
        (text) => text.includes('handling VideoAccepted'),
      );
      await deliver('video.accepted', { correlationId: 'cat-9' });

      const handling = lines.find((l) => l.msg === 'handling VideoAccepted');
      expect(handling?.correlationId).toBe('cat-9');
      const text = await metricsText();
      expect(text).toContain(
        'fiapx_events_consumed_total{event="VideoAccepted",outcome="acked"} 1',
      );
      expect(text).toContain(
        'fiapx_events_consumed_total{event="VideoAccepted",outcome="dead_lettered"} 1',
      );
    });
  });

  describe('outbox metrics (OBS-23, OBS-24)', () => {
    it('reports seeded pending rows, their age and the refused publishes on /metrics', async () => {
      broker.refuse = true;
      await dataSource.query('DELETE FROM outbox');
      for (let i = 0; i < 3; i++) {
        await dataSource.query(
          `INSERT INTO outbox (queue, pattern, payload, created_at, published_at)
           VALUES ('notification.terminal', 'terminal.event', $1::jsonb, now() - interval '120 seconds', NULL)`,
          [JSON.stringify({ eventId: randomUUID() })],
        );
      }

      await expect(app.get(OutboxRelay).drain()).rejects.toThrow(
        'broker refused',
      );
      const text = await metricsText();

      expect(text).toContain('fiapx_outbox_pending_rows 3');
      const age = Number(
        /^fiapx_outbox_oldest_pending_seconds (\d+)$/m.exec(text)?.[1],
      );
      expect(age).toBeGreaterThanOrEqual(120);
      const failures = Number(
        /^fiapx_outbox_publish_failures_total (\d+)$/m.exec(text)?.[1],
      );
      // The scheduler may have tried too; each attempt counts once.
      expect(failures).toBeGreaterThanOrEqual(1);
      const pending: { n: number }[] = await dataSource.query(
        'SELECT count(*)::int AS n FROM outbox WHERE published_at IS NULL',
      );
      expect(pending[0].n).toBe(3);
      await dataSource.query('DELETE FROM outbox');
    });
  });

  describe('health and metrics with the broker stopped (OBS-26, success criterion)', () => {
    it('answers /health 503 naming rabbitmq while /health/live and /metrics stay 200', async () => {
      broker.connected = false;

      const ready = await http().get('/health');
      const live = await http().get('/health/live');
      const metrics = await http().get('/metrics');

      expect(ready.status).toBe(503);
      expect(ready.body).toStrictEqual({
        status: 'error',
        rabbitmq: 'down',
        database: 'up',
      });
      expect(live.status).toBe(200);
      expect(metrics.status).toBe(200);
      expect(metrics.text).toContain(
        '# TYPE fiapx_events_consumed_total counter',
      );
    });
  });

  describe('health and metrics with the database stopped (OBS-26, edge case)', () => {
    it('answers /health 503 naming the database while /health/live and /metrics stay 200', async () => {
      await metricsText();
      await dataSource.destroy();

      const ready = await http().get('/health');
      const live = await http().get('/health/live');
      const metrics = await http().get('/metrics');

      expect(ready.status).toBe(503);
      expect(ready.body).toStrictEqual({
        status: 'error',
        rabbitmq: 'up',
        database: 'down',
      });
      expect(live.status).toBe(200);
      expect(metrics.status).toBe(200);
      expect(metrics.text).toContain('# TYPE fiapx_outbox_pending_rows gauge');
    });
  });

  describe('logs (OBS-22, OBS-28)', () => {
    it('writes every line of a create as JSON with the propagated id and never the owner email', async () => {
      const ownerUserId = owner();
      const body = { ...createBody(ownerUserId), correlationId: 'cat-log' };

      const lines = await capturingLogs(
        () =>
          http()
            .post('/processing-requests')
            .set('X-Correlation-Id', 'cat-log')
            .send(body),
        (text) => text.includes('"msg":"request completed"'),
      );

      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).toEqual(
          expect.objectContaining({
            service: 'processing-catalog',
            correlationId: 'cat-log',
            level: expect.any(Number) as unknown,
            timestamp: expect.any(Number) as unknown,
            msg: expect.any(String) as unknown,
          }),
        );
        expect(JSON.stringify(line)).not.toContain(body.ownerEmail);
      }
    });

    it('writes no access-log line for /health, /health/live or /metrics', async () => {
      const lines = await capturingLogs(
        async () => {
          await http().get('/health');
          await http().get('/health/live');
          await http().get('/metrics');
          await http().get('/');
        },
        (text) => text.includes('"msg":"request completed"'),
      );

      const urls = lines
        .filter((l) => l.msg === 'request completed')
        .map((l) => (l.req as { url: string }).url);
      expect(urls).toEqual(['/']);
    });
  });
});
