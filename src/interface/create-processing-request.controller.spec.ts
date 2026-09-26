import {
  InMemoryOutboxWriter,
  InMemoryUnitOfWork,
} from '../infrastructure/in-memory-unit-of-work';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import supertest from 'supertest';
import { CreateProcessingRequestController } from './create-processing-request.controller';
import { CreateProcessingRequestUseCase } from '../application/create-processing-request.use-case';
import { InMemoryProcessingRequestRepository } from '../infrastructure/in-memory-processing-request.repository';

interface CreateProcessingRequestResponse {
  processingRequestId: string;
  status: string;
  ownerUserId: string;
  sourceStorageKey: string;
  createdAt: string;
}

describe('CreateProcessingRequestController (integration)', () => {
  let app: INestApplication;
  let outbox: InMemoryOutboxWriter;
  let unitOfWork: InMemoryUnitOfWork;
  let request: ReturnType<typeof supertest>;

  beforeEach(async () => {
    const repository = new InMemoryProcessingRequestRepository();
    outbox = new InMemoryOutboxWriter();
    unitOfWork = new InMemoryUnitOfWork(repository, outbox);
    const useCase = new CreateProcessingRequestUseCase(repository, unitOfWork);

    const moduleRef = await Test.createTestingModule({
      controllers: [CreateProcessingRequestController],
      providers: [
        { provide: CreateProcessingRequestUseCase, useValue: useCase },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    request = supertest(app.getHttpServer() as import('http').Server);
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates a processing request and returns its public fields', async () => {
    const response = await request.post('/processing-requests').send({
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
    expect(body.createdAt).toBeDefined();
  });

  it('rejects a request without ownerUserId', async () => {
    const response = await request.post('/processing-requests').send({
      sourceStorageKey: 'videos/input.mp4',
      idempotencyKey: 'key-1',
    });

    expect(response.status).toBe(400);
  });

  it('rejects a request without sourceStorageKey', async () => {
    const response = await request.post('/processing-requests').send({
      ownerUserId: 'user-123',
      idempotencyKey: 'key-1',
    });

    expect(response.status).toBe(400);
  });
});
