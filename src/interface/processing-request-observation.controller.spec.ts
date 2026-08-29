import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import supertest, { SuperTest, Test as RequestTest } from 'supertest';
import { ProcessingRequestObservationController } from './processing-request-observation.controller';
import { InMemoryProcessingRequestRepository } from '../infrastructure/in-memory-processing-request.repository';
import { createProcessingRequest } from '../domain/processing-request';

interface ProcessingRequestStateResponse {
  processingRequestId: string;
  ownerUserId: string;
  sourceStorageKey: string;
  status: string;
  attemptId: string | undefined;
  zipStorageKey: string | undefined;
  createdAt: string;
  updatedAt: string;
}

describe('ProcessingRequestObservationController (integration)', () => {
  let app: INestApplication;
  let repository: InMemoryProcessingRequestRepository;
  let request: SuperTest<RequestTest>;

  beforeEach(async () => {
    repository = new InMemoryProcessingRequestRepository();

    const moduleRef = await Test.createTestingModule({
      controllers: [ProcessingRequestObservationController],
      providers: [
        {
          provide: 'ProcessingRequestRepository',
          useValue: repository,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    request = supertest(app.getHttpServer() as import('http').Server);
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns the current state of an existing request', async () => {
    const stored = createProcessingRequest({
      ownerUserId: 'user-123',
      sourceStorageKey: 'videos/input.mp4',
    });
    repository.save(stored);

    const response = await request.get(
      `/processing-requests/${stored.processingRequestId}`,
    );

    const body = response.body as ProcessingRequestStateResponse;

    expect(response.status).toBe(200);
    expect(body.processingRequestId).toBe(stored.processingRequestId);
    expect(body.status).toBe('RECEIVED');
    expect(body.ownerUserId).toBe('user-123');
    expect(body.sourceStorageKey).toBe('videos/input.mp4');
  });

  it('returns 404 for an unknown request', async () => {
    const response = await request.get('/processing-requests/unknown-id');

    expect(response.status).toBe(404);
  });
});
