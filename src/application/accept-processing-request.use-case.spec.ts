import {
  InMemoryOutboxWriter,
  InMemoryUnitOfWork,
} from '../infrastructure/in-memory-unit-of-work';
import { randomUUID } from 'crypto';
import { ProcessingRequestStatus } from '../domain/processing-request';
import { InMemoryProcessingRequestRepository } from '../infrastructure/in-memory-processing-request.repository';
import { AcceptProcessingRequestUseCase } from './accept-processing-request.use-case';
import { CreateProcessingRequestUseCase } from './create-processing-request.use-case';

describe('AcceptProcessingRequestUseCase', () => {
  let repository: InMemoryProcessingRequestRepository;
  let outbox: InMemoryOutboxWriter;
  let unitOfWork: InMemoryUnitOfWork;
  let useCase: AcceptProcessingRequestUseCase;

  beforeEach(() => {
    repository = new InMemoryProcessingRequestRepository();
    outbox = new InMemoryOutboxWriter();
    unitOfWork = new InMemoryUnitOfWork(repository, outbox);
    useCase = new AcceptProcessingRequestUseCase(repository, unitOfWork);
  });

  const createRequest = async () => {
    const createUseCase = new CreateProcessingRequestUseCase(
      repository,
      unitOfWork,
    );
    const { request } = await createUseCase.execute({
      eventId: randomUUID(),
      ownerUserId: 'user-123',
      sourceStorageKey: 'videos/input.mp4',
      idempotencyKey: randomUUID(),
    });
    return request;
  };

  it('transitions a request from RECEIVED to QUEUED and publishes ProcessingQueued', async () => {
    const request = await createRequest();
    const eventId = 'accepted-event-1';
    const occurredAt = new Date().toISOString();

    const updated = await useCase.execute({
      eventId,
      processingRequestId: request.processingRequestId,
      occurredAt,
    });

    expect(updated.status).toBe(ProcessingRequestStatus.QUEUED);
    expect(updated.attemptId).toBeDefined();

    const found = await repository.findByProcessingRequestId(
      request.processingRequestId,
    );
    expect(found?.status).toBe(ProcessingRequestStatus.QUEUED);
    expect(found?.attemptId).toBe(updated.attemptId);

    expect(outbox.recordedProcessingQueued).toHaveLength(1);
    const published = outbox.recordedProcessingQueued.at(-1);
    expect(published?.processingRequestId).toBe(request.processingRequestId);
    expect(published?.ownerUserId).toBe('user-123');
    expect(published?.sourceStorageKey).toBe('videos/input.mp4');
    expect(published?.attemptId).toBe(updated.attemptId);
    expect(published?.occurredAt).toBe(occurredAt);
  });

  it('is idempotent for a repeated eventId', async () => {
    const request = await createRequest();
    const eventId = 'accepted-event-2';

    await useCase.execute({
      eventId,
      processingRequestId: request.processingRequestId,
      occurredAt: new Date().toISOString(),
    });

    await useCase.execute({
      eventId,
      processingRequestId: request.processingRequestId,
      occurredAt: new Date().toISOString(),
    });

    expect(outbox.recordedProcessingQueued).toHaveLength(1);

    const found = await repository.findByProcessingRequestId(
      request.processingRequestId,
    );
    expect(found?.status).toBe(ProcessingRequestStatus.QUEUED);
  });

  it('rejects an event without processingRequestId', async () => {
    await expect(
      useCase.execute({
        eventId: 'accepted-event-3',
        processingRequestId: '',
        occurredAt: new Date().toISOString(),
      }),
    ).rejects.toThrow('processingRequestId is required');

    expect(outbox.recordedProcessingQueued).toHaveLength(0);
  });

  it('rejects an unsupported transition without publishing or changing state', async () => {
    const request = await createRequest();
    await useCase.execute({
      eventId: 'accepted-event-4',
      processingRequestId: request.processingRequestId,
      occurredAt: new Date().toISOString(),
    });

    await expect(
      useCase.execute({
        eventId: 'accepted-event-5',
        processingRequestId: request.processingRequestId,
        occurredAt: new Date().toISOString(),
      }),
    ).rejects.toThrow('Cannot accept request in QUEUED status');

    expect(outbox.recordedProcessingQueued).toHaveLength(1);

    const found = await repository.findByProcessingRequestId(
      request.processingRequestId,
    );
    expect(found?.status).toBe(ProcessingRequestStatus.QUEUED);
    expect(found?.attemptId).toBeDefined();
  });

  it('propagates an outbox write failure without marking the event processed', async () => {
    const request = await createRequest();
    // The use case no longer publishes: a failure to record the event in the
    // outbox is what must abort the transition now.
    outbox.add = () => Promise.reject(new Error('outbox write failed'));

    await expect(
      useCase.execute({
        eventId: 'accepted-event-6',
        processingRequestId: request.processingRequestId,
        occurredAt: new Date().toISOString(),
      }),
    ).rejects.toThrow('outbox write failed');

    expect(await repository.hasEventBeenProcessed('accepted-event-6')).toBe(
      false,
    );
  });
});
