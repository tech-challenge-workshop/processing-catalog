import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { InMemoryEventPublisher } from './../src/infrastructure/in-memory-event-publisher';
import { InMemoryProcessingRequestRepository } from './../src/infrastructure/in-memory-processing-request.repository';

interface CreateProcessingRequestResponse {
  processingRequestId: string;
  status: string;
  ownerUserId: string;
  sourceStorageKey: string;
  createdAt: string;
}

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  let publisher: InMemoryEventPublisher;
  let repository: InMemoryProcessingRequestRepository;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    publisher = app.get(InMemoryEventPublisher);
    repository = app.get(InMemoryProcessingRequestRepository);
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
        });

      const body = response.body as CreateProcessingRequestResponse;

      expect(response.status).toBe(201);
      expect(body.processingRequestId).toBeDefined();
      expect(body.status).toBe('RECEIVED');
      expect(body.ownerUserId).toBe('user-123');
      expect(body.sourceStorageKey).toBe('videos/input.mp4');

      expect(publisher.lastPublished).toBeDefined();
      expect(publisher.lastPublished!.processingRequestId).toBe(
        body.processingRequestId,
      );
      expect(publisher.lastPublished!.ownerUserId).toBe('user-123');
      expect(publisher.lastPublished!.sourceStorageKey).toBe(
        'videos/input.mp4',
      );
      expect(publisher.lastPublished!.occurredAt).toBe(body.createdAt);
    });

    it('rejects creation with missing fields', async () => {
      const response = await request(app.getHttpServer())
        .post('/processing-requests')
        .send({ ownerUserId: 'user-123' });

      expect(response.status).toBe(400);
      expect(publisher.published).toHaveLength(0);
      expect(repository.findByEventId('any')).toBeUndefined();
    });

    it('does not expose the observation route when LOCAL_INTEGRATION is unset', async () => {
      const response = await request(app.getHttpServer())
        .get('/processing-requests/any-id')
        .send();

      expect(response.status).toBe(404);
    });
  });

  afterEach(async () => {
    await app.close();
  }, 30_000);
});
