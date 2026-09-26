process.env.LOCAL_INTEGRATION = 'true';

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { RabbitMQConnection } from '../src/infrastructure/rabbitmq/rabbitmq.connection';
import { InMemoryProcessingRequestRepository } from '../src/infrastructure/in-memory-processing-request.repository';
import { InMemoryOutboxWriter } from '../src/infrastructure/in-memory-unit-of-work';
import { ProcessingRequestStatus } from '../src/domain/processing-request';

// This suite exercises the in-memory composition. It pins DATABASE_HOST off
// rather than inheriting it: with a database configured the composition root
// selects TypeORM, and the in-memory doubles this suite reads would still
// resolve from the container while the app used something else entirely -
// asserting against a bystander. That is the same shape as the wiring gap
// composition.e2e-spec.ts now guards.
const databaseEnv = [
  'DATABASE_HOST',
  'DATABASE_PORT',
  'DATABASE_NAME',
  'DATABASE_SCHEMA',
  'DATABASE_USER',
  'DATABASE_PASSWORD',
] as const;
const savedDatabaseEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of databaseEnv) {
    savedDatabaseEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterAll(() => {
  for (const key of databaseEnv) {
    if (savedDatabaseEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedDatabaseEnv[key];
    }
  }
});

interface CreateProcessingRequestResponse {
  processingRequestId: string;
  status: string;
  ownerUserId: string;
  sourceStorageKey: string;
  createdAt: string;
}

interface ProcessingRequestStateResponse {
  processingRequestId: string;
  status: string;
  ownerUserId: string;
  sourceStorageKey: string;
  attemptId: string | undefined;
  zipStorageKey: string | undefined;
  createdAt: string;
  updatedAt: string;
}

interface PublishedEvent {
  queue: string;
  pattern: string;
  content: unknown;
}

interface FakeMessage {
  content: Buffer;
  ack: () => void;
  nack: () => void;
}

/**
 * The members of `RabbitMQConnection` whose real signatures this fake honours
 * exactly.
 *
 * Declared as a `Pick` rather than `Partial`: `Partial` makes every member
 * optional, so when `sendToQueue` was introduced and the publisher started
 * calling it, the fake compiled cleanly and only failed at runtime. A `Pick`
 * makes a signature change - or a newly required member added to this list -
 * break compilation instead.
 *
 * `getPublishChannel` and `getConsumeChannel` are deliberately outside the
 * contract: they return a `ChannelWrapper`, which a fake cannot satisfy
 * structurally without pulling in the whole amqp-connection-manager surface.
 */
type RabbitMQConnectionContract = Pick<
  RabbitMQConnection,
  'isConnected' | 'sendToQueue' | 'onModuleDestroy'
>;

class FakeRabbitMQConnection implements RabbitMQConnectionContract {
  published: PublishedEvent[] = [];
  private consumers = new Map<string, (message: FakeMessage) => void>();

  isConnected(): boolean {
    return true;
  }

  async sendToQueue(
    queue: string,
    pattern: string,
    event: unknown,
  ): Promise<void> {
    this.published.push({ queue, pattern, content: event });
    return Promise.resolve();
  }

  getPublishChannel(): {
    publish: (
      exchange: string,
      routingKey: string,
      content: unknown,
    ) => Promise<boolean>;
  } {
    return {
      publish: (exchange, routingKey, content) => {
        this.published.push({ queue: exchange, pattern: routingKey, content });
        return Promise.resolve(true);
      },
    };
  }

  getConsumeChannel(): {
    consume: (
      queue: string,
      onMessage: (message: FakeMessage) => void,
    ) => Promise<{ consumerTag: string }>;
    ack: () => void;
    nack: () => void;
  } {
    return {
      consume: (queue, onMessage) => {
        this.consumers.set(queue, onMessage);
        return Promise.resolve({ consumerTag: queue });
      },
      ack: () => {},
      nack: () => {},
    };
  }

  async onModuleDestroy(): Promise<void> {}

  async close(): Promise<void> {}

  deliver(queue: string, content: unknown): void {
    const handler = this.consumers.get(queue);
    if (handler) {
      handler({
        content: Buffer.from(JSON.stringify(content)),
        ack: () => {},
        nack: () => {},
      });
    }
  }
}

describe('Local Docker Integration (e2e)', () => {
  let app: INestApplication;
  let fakeConnection: FakeRabbitMQConnection;
  let repository: InMemoryProcessingRequestRepository;
  let outbox: InMemoryOutboxWriter;

  beforeAll(async () => {
    fakeConnection = new FakeRabbitMQConnection();

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RabbitMQConnection)
      .useValue(fakeConnection)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    repository = app.get(InMemoryProcessingRequestRepository);
    // The Catalog no longer publishes: what it emits is a pending outbox row,
    // and the relay is the only thing that reaches the broker.
    outbox = app.get(InMemoryOutboxWriter);
  }, 30_000);

  afterAll(async () => {
    await app.close();
  }, 30_000);

  const waitForMessage = () =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });

  it('runs RECEIVED → QUEUED → COMPLETED through the local broker', async () => {
    const createResponse = await request(
      app.getHttpServer() as import('http').Server,
    )
      .post('/processing-requests')
      .send({
        ownerUserId: 'user-123',
        sourceStorageKey: 'videos/input.mp4',
      });

    const body = createResponse.body as CreateProcessingRequestResponse;
    expect(createResponse.status).toBe(201);
    expect(body.status).toBe('RECEIVED');

    expect(outbox.entries).toHaveLength(1);
    expect(outbox.entries[0].queue).toBe('video-validation');
    expect(outbox.entries[0].pattern).toBe('VideoValidationRequested');

    fakeConnection.deliver('video.accepted', {
      eventId: 'video-accepted-1',
      processingRequestId: body.processingRequestId,
      occurredAt: new Date().toISOString(),
    });
    await waitForMessage();

    const queued = await repository.findByProcessingRequestId(
      body.processingRequestId,
    );
    expect(queued?.status).toBe(ProcessingRequestStatus.QUEUED);
    expect(queued?.attemptId).toBeDefined();
    expect(outbox.entries).toHaveLength(2);
    expect(outbox.entries[1].queue).toBe('processing');
    expect(outbox.entries[1].pattern).toBe('ProcessingQueued');

    const queuedEvent = outbox.entries[1].payload as {
      attemptId: string;
    };
    expect(queuedEvent.attemptId).toBe(queued?.attemptId);

    fakeConnection.deliver('processing.started', {
      eventId: 'processing-started-1',
      processingRequestId: body.processingRequestId,
      attemptId: queued!.attemptId,
      occurredAt: new Date().toISOString(),
    });
    await waitForMessage();

    const processing = await repository.findByProcessingRequestId(
      body.processingRequestId,
    );
    expect(processing?.status).toBe(ProcessingRequestStatus.PROCESSING);
    // Entering PROCESSING is not terminal and publishes nothing.
    expect(outbox.entries).toHaveLength(2);

    fakeConnection.deliver('processing.completed', {
      eventId: 'processing-completed-1',
      processingRequestId: body.processingRequestId,
      zipStorageKey: 'zips/output.zip',
      occurredAt: new Date().toISOString(),
    });
    await waitForMessage();

    const completed = await repository.findByProcessingRequestId(
      body.processingRequestId,
    );
    expect(completed?.status).toBe(ProcessingRequestStatus.COMPLETED);
    expect(completed?.zipStorageKey).toBe('zips/output.zip');
    expect(outbox.entries).toHaveLength(3);
    expect(outbox.entries[2].queue).toBe('notification.terminal');
    expect(outbox.entries[2].pattern).toBe('terminal.event');

    const terminalEvent = outbox.entries[2].payload as {
      status: string;
      zipStorageKey?: string;
      failureReason?: string;
    };
    expect(terminalEvent.status).toBe('COMPLETED');
    expect(terminalEvent.zipStorageKey).toBe('zips/output.zip');
    expect(terminalEvent.failureReason).toBeUndefined();
  });

  it('does not transition or publish on duplicate events', async () => {
    const createResponse = await request(
      app.getHttpServer() as import('http').Server,
    )
      .post('/processing-requests')
      .send({
        ownerUserId: 'user-456',
        sourceStorageKey: 'videos/duplicate.mp4',
      });

    const body = createResponse.body as CreateProcessingRequestResponse;
    outbox.clear();

    fakeConnection.deliver('video.accepted', {
      eventId: 'duplicate-accept',
      processingRequestId: body.processingRequestId,
      occurredAt: new Date().toISOString(),
    });
    await waitForMessage();

    fakeConnection.deliver('video.accepted', {
      eventId: 'duplicate-accept',
      processingRequestId: body.processingRequestId,
      occurredAt: new Date().toISOString(),
    });
    await waitForMessage();

    expect(outbox.entries).toHaveLength(1);
  });

  it('does not transition on invalid payload', async () => {
    const createResponse = await request(
      app.getHttpServer() as import('http').Server,
    )
      .post('/processing-requests')
      .send({
        ownerUserId: 'user-789',
        sourceStorageKey: 'videos/invalid.mp4',
      });

    const body = createResponse.body as CreateProcessingRequestResponse;
    const previousLength = outbox.entries.length;

    fakeConnection.deliver('processing.completed', {
      eventId: 'invalid-complete',
      processingRequestId: body.processingRequestId,
      zipStorageKey: 'zips/output.zip',
      occurredAt: new Date().toISOString(),
    });
    await waitForMessage();

    const stored = await repository.findByProcessingRequestId(
      body.processingRequestId,
    );
    expect(stored?.status).toBe(ProcessingRequestStatus.RECEIVED);
    expect(outbox.entries).toHaveLength(previousLength);
  });

  it('exposes the observation endpoint when LOCAL_INTEGRATION=true', async () => {
    const createResponse = await request(
      app.getHttpServer() as import('http').Server,
    )
      .post('/processing-requests')
      .send({
        ownerUserId: 'user-obs',
        sourceStorageKey: 'videos/obs.mp4',
      });

    const body = createResponse.body as CreateProcessingRequestResponse;
    const response = await request(
      app.getHttpServer() as import('http').Server,
    ).get(`/processing-requests/${body.processingRequestId}`);

    const state = response.body as ProcessingRequestStateResponse;

    expect(response.status).toBe(200);
    expect(state.status).toBe('RECEIVED');
  });

  it('serves the owned routes when LOCAL_INTEGRATION=true as well', async () => {
    const created = await request(app.getHttpServer() as import('http').Server)
      .post('/processing-requests')
      .send({ ownerUserId: 'user-owned', sourceStorageKey: 'videos/o.mp4' });
    const body = created.body as CreateProcessingRequestResponse;

    const list = await request(
      app.getHttpServer() as import('http').Server,
    ).get('/owners/user-owned/processing-requests');
    const one = await request(app.getHttpServer() as import('http').Server).get(
      `/owners/user-owned/processing-requests/${body.processingRequestId}`,
    );

    expect(list.status).toBe(200);
    expect(
      (list.body as { items: { processingRequestId: string }[] }).items.map(
        (i) => i.processingRequestId,
      ),
    ).toEqual([body.processingRequestId]);
    expect(one.status).toBe(200);
    expect(
      (one.body as { processingRequestId: string }).processingRequestId,
    ).toBe(body.processingRequestId);
  });

  it('returns 200 on /health when RabbitMQ is up', async () => {
    const response = await request(
      app.getHttpServer() as import('http').Server,
    ).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      rabbitmq: 'up',
      database: 'up',
    });
  });

  const createRequest = async (ownerUserId: string, key: string) => {
    const response = await request(app.getHttpServer() as import('http').Server)
      .post('/processing-requests')
      .send({ ownerUserId, sourceStorageKey: key });
    return response.body as CreateProcessingRequestResponse;
  };

  it('reaches FAILED through VideoRejected and publishes one terminal event', async () => {
    const body = await createRequest('user-rejeitado', 'videos/bad.txt');
    outbox.clear();

    fakeConnection.deliver('video.rejected', {
      eventId: 'video-rejected-1',
      processingRequestId: body.processingRequestId,
      failureCode: 'FORMATO_INVALIDO',
      occurredAt: new Date().toISOString(),
    });
    await waitForMessage();

    const failed = await repository.findByProcessingRequestId(
      body.processingRequestId,
    );
    expect(failed?.status).toBe(ProcessingRequestStatus.FAILED);
    expect(failed?.failureCode).toBe('FORMATO_INVALIDO');

    expect(outbox.entries).toHaveLength(1);
    expect(outbox.entries[0].queue).toBe('notification.terminal');
    expect(outbox.entries[0].pattern).toBe('terminal.event');

    const terminal = outbox.entries[0].payload as {
      status: string;
      failureReason?: string;
      zipStorageKey?: string;
      attemptId?: string;
    };
    expect(terminal.status).toBe('FAILED');
    expect(terminal.failureReason).toBeTruthy();
    expect(terminal.zipStorageKey).toBeUndefined();
    // Rejected before validation accepted it, so no attempt ever started.
    expect(terminal.attemptId).toBeUndefined();
    expect(terminal.failureReason).not.toContain('FORMATO_INVALIDO');
  });

  it('reaches FAILED through ProcessingFailed after starting', async () => {
    const body = await createRequest('user-falhou', 'videos/input.mp4');

    fakeConnection.deliver('video.accepted', {
      eventId: 'accepted-for-failure',
      processingRequestId: body.processingRequestId,
      occurredAt: new Date().toISOString(),
    });
    await waitForMessage();

    const queued = await repository.findByProcessingRequestId(
      body.processingRequestId,
    );

    fakeConnection.deliver('processing.started', {
      eventId: 'started-for-failure',
      processingRequestId: body.processingRequestId,
      attemptId: queued!.attemptId,
      occurredAt: new Date().toISOString(),
    });
    await waitForMessage();
    expect(
      (await repository.findByProcessingRequestId(body.processingRequestId))
        ?.status,
    ).toBe(ProcessingRequestStatus.PROCESSING);

    outbox.clear();
    fakeConnection.deliver('processing.failed', {
      eventId: 'failed-for-failure',
      processingRequestId: body.processingRequestId,
      attemptId: queued!.attemptId,
      failureCode: 'PROCESSAMENTO_FALHOU',
      occurredAt: new Date().toISOString(),
    });
    await waitForMessage();

    const failed = await repository.findByProcessingRequestId(
      body.processingRequestId,
    );
    expect(failed?.status).toBe(ProcessingRequestStatus.FAILED);
    expect(failed?.failureCode).toBe('PROCESSAMENTO_FALHOU');

    expect(outbox.entries).toHaveLength(1);
    const terminal = outbox.entries[0].payload as {
      status: string;
      failureReason?: string;
      attemptId?: string;
    };
    expect(terminal.status).toBe('FAILED');
    // The attempt had started, so the terminal event names it.
    expect(terminal.attemptId).toBe(queued!.attemptId);
  });

  it('replays every lifecycle event without changing state or publishing again', async () => {
    const body = await createRequest('user-replay', 'videos/input.mp4');

    const deliveries: [string, Record<string, unknown>][] = [
      [
        'video.accepted',
        {
          eventId: 'replay-accepted',
          processingRequestId: body.processingRequestId,
          occurredAt: new Date().toISOString(),
        },
      ],
    ];
    for (const [queue, payload] of deliveries) {
      fakeConnection.deliver(queue, payload);
      await waitForMessage();
    }

    const queued = await repository.findByProcessingRequestId(
      body.processingRequestId,
    );
    fakeConnection.deliver('processing.started', {
      eventId: 'replay-started',
      processingRequestId: body.processingRequestId,
      attemptId: queued!.attemptId,
      occurredAt: new Date().toISOString(),
    });
    await waitForMessage();
    fakeConnection.deliver('processing.completed', {
      eventId: 'replay-completed',
      processingRequestId: body.processingRequestId,
      zipStorageKey: 'zips/replay.zip',
      occurredAt: new Date().toISOString(),
    });
    await waitForMessage();

    const settled = await repository.findByProcessingRequestId(
      body.processingRequestId,
    );
    const publishedCount = outbox.entries.length;

    // Replay everything, including the event that produced the terminal state.
    fakeConnection.deliver('video.accepted', {
      eventId: 'replay-accepted',
      processingRequestId: body.processingRequestId,
      occurredAt: new Date().toISOString(),
    });
    fakeConnection.deliver('processing.started', {
      eventId: 'replay-started',
      processingRequestId: body.processingRequestId,
      attemptId: queued!.attemptId,
      occurredAt: new Date().toISOString(),
    });
    fakeConnection.deliver('processing.completed', {
      eventId: 'replay-completed',
      processingRequestId: body.processingRequestId,
      zipStorageKey: 'zips/replay.zip',
      occurredAt: new Date().toISOString(),
    });
    await waitForMessage();

    const afterReplay = await repository.findByProcessingRequestId(
      body.processingRequestId,
    );
    expect(afterReplay?.status).toBe(settled?.status);
    expect(afterReplay?.zipStorageKey).toBe(settled?.zipStorageKey);
    expect(afterReplay?.updatedAt).toEqual(settled?.updatedAt);
    expect(outbox.entries).toHaveLength(publishedCount);
  });
});
