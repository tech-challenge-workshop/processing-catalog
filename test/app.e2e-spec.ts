import { InMemoryOutboxWriter } from '../src/infrastructure/in-memory-unit-of-work';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { InMemoryProcessingRequestRepository } from './../src/infrastructure/in-memory-processing-request.repository';

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

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  let outbox: InMemoryOutboxWriter;
  let repository: InMemoryProcessingRequestRepository;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    repository = app.get(InMemoryProcessingRequestRepository);
    outbox = app.get(InMemoryOutboxWriter);
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  describe('/processing-requests (POST)', () => {
    it('creates a request and publishes VideoValidationRequested', async () => {
      const response = await request(app.getHttpServer())
        .post('/processing-requests')
        .send({
          ownerUserId: 'user-123',
          sourceStorageKey: 'videos/input.mp4',
          idempotencyKey: 'key-1',
        });

      const body = response.body as CreateProcessingRequestResponse;

      expect(response.status).toBe(201);
      expect(body.processingRequestId).toBeDefined();
      expect(body.status).toBe('RECEIVED');
      expect(body.ownerUserId).toBe('user-123');
      expect(body.sourceStorageKey).toBe('videos/input.mp4');

      expect(outbox.recordedValidationRequests.at(-1)).toBeDefined();
      expect(
        outbox.recordedValidationRequests.at(-1)!.processingRequestId,
      ).toBe(body.processingRequestId);
      expect(outbox.recordedValidationRequests.at(-1)!.ownerUserId).toBe(
        'user-123',
      );
      expect(outbox.recordedValidationRequests.at(-1)!.sourceStorageKey).toBe(
        'videos/input.mp4',
      );
      expect(outbox.recordedValidationRequests.at(-1)!.occurredAt).toBe(
        body.createdAt,
      );
    });

    it('rejects creation with missing fields', async () => {
      const response = await request(app.getHttpServer())
        .post('/processing-requests')
        .send({ ownerUserId: 'user-123', idempotencyKey: 'key-1' });

      expect(response.status).toBe(400);
      expect(outbox.recordedValidationRequests).toHaveLength(0);
      await expect(repository.findByEventId('any')).resolves.toBeUndefined();
    });

    it('does not expose the observation route when LOCAL_INTEGRATION is unset', async () => {
      const created = await request(app.getHttpServer())
        .post('/processing-requests')
        .send({
          ownerUserId: 'user-123',
          sourceStorageKey: 'videos/input.mp4',
          idempotencyKey: 'key-1',
        });

      const body = created.body as CreateProcessingRequestResponse;

      const response = await request(app.getHttpServer())
        .get(`/processing-requests/${body.processingRequestId}`)
        .send();

      expect(response.status).toBe(404);
    });
  });

  afterEach(async () => {
    await app.close();
  }, 30_000);
});
