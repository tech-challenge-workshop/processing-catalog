process.env.LOCAL_INTEGRATION = 'true';

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { RabbitMQConnection } from '../src/infrastructure/rabbitmq/rabbitmq.connection';
import { InMemoryProcessingRequestRepository } from '../src/infrastructure/in-memory-processing-request.repository';
import { ProcessingRequestStatus } from '../src/domain/processing-request';

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
  exchange: string;
  routingKey: string;
  content: unknown;
}

interface FakeMessage {
  content: Buffer;
  ack: () => void;
  nack: () => void;
}

class FakeRabbitMQConnection implements Partial<RabbitMQConnection> {
  published: PublishedEvent[] = [];
  private consumers = new Map<string, (message: FakeMessage) => void>();

  isConnected(): boolean {
    return true;
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
        this.published.push({ exchange, routingKey, content });
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

    expect(fakeConnection.published).toHaveLength(1);
    expect(fakeConnection.published[0].routingKey).toBe(
      'video.validation.requested',
    );

    fakeConnection.deliver('video.accepted', {
      eventId: 'video-accepted-1',
      processingRequestId: body.processingRequestId,
      occurredAt: new Date().toISOString(),
    });
    await waitForMessage();

    const queued = repository.findByProcessingRequestId(
      body.processingRequestId,
    );
    expect(queued?.status).toBe(ProcessingRequestStatus.QUEUED);
    expect(queued?.attemptId).toBeDefined();
    expect(fakeConnection.published).toHaveLength(2);
    expect(fakeConnection.published[1].routingKey).toBe('processing.queued');

    const queuedEvent = fakeConnection.published[1].content as {
      attemptId: string;
    };
    expect(queuedEvent.attemptId).toBe(queued?.attemptId);

    fakeConnection.deliver('processing.completed', {
      eventId: 'processing-completed-1',
      processingRequestId: body.processingRequestId,
      zipStorageKey: 'zips/output.zip',
      occurredAt: new Date().toISOString(),
    });
    await waitForMessage();

    const completed = repository.findByProcessingRequestId(
      body.processingRequestId,
    );
    expect(completed?.status).toBe(ProcessingRequestStatus.COMPLETED);
    expect(completed?.zipStorageKey).toBe('zips/output.zip');
    expect(fakeConnection.published).toHaveLength(3);
    expect(fakeConnection.published[2].routingKey).toBe('processing.terminal');

    const terminalEvent = fakeConnection.published[2].content as {
      status: string;
      zipStorageKey: string;
    };
    expect(terminalEvent.status).toBe('COMPLETED');
    expect(terminalEvent.zipStorageKey).toBe('zips/output.zip');
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
    fakeConnection.published = [];

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

    expect(fakeConnection.published).toHaveLength(1);
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
    const previousLength = fakeConnection.published.length;

    fakeConnection.deliver('processing.completed', {
      eventId: 'invalid-complete',
      processingRequestId: body.processingRequestId,
      zipStorageKey: 'zips/output.zip',
      occurredAt: new Date().toISOString(),
    });
    await waitForMessage();

    const stored = repository.findByProcessingRequestId(
      body.processingRequestId,
    );
    expect(stored?.status).toBe(ProcessingRequestStatus.RECEIVED);
    expect(fakeConnection.published).toHaveLength(previousLength);
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

  it('returns 200 on /health when RabbitMQ is up', async () => {
    const response = await request(
      app.getHttpServer() as import('http').Server,
    ).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', rabbitmq: 'up' });
  });
});
