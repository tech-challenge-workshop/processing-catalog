import { randomUUID } from 'crypto';
import { ProcessingRequestStatus } from '../domain/processing-request';
import { InMemoryProcessingRequestRepository } from '../infrastructure/in-memory-processing-request.repository';
import { InMemoryEventPublisher } from '../infrastructure/in-memory-event-publisher';
import { AcceptProcessingRequestUseCase } from './accept-processing-request.use-case';
import { CreateProcessingRequestUseCase } from './create-processing-request.use-case';

describe('AcceptProcessingRequestUseCase', () => {
  let repository: InMemoryProcessingRequestRepository;
  let publisher: InMemoryEventPublisher;
  let useCase: AcceptProcessingRequestUseCase;

  beforeEach(() => {
    repository = new InMemoryProcessingRequestRepository();
    publisher = new InMemoryEventPublisher();
    useCase = new AcceptProcessingRequestUseCase(repository, publisher);
  });

  const createRequest = async () => {
    const createUseCase = new CreateProcessingRequestUseCase(
      repository,
      publisher,
    );
    return createUseCase.execute({
      eventId: randomUUID(),
      ownerUserId: 'user-123',
      sourceStorageKey: 'videos/input.mp4',
    });
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

    const found = repository.findByProcessingRequestId(
      request.processingRequestId,
    );
    expect(found?.status).toBe(ProcessingRequestStatus.QUEUED);
    expect(found?.attemptId).toBe(updated.attemptId);

    expect(publisher.publishedProcessingQueued).toHaveLength(1);
    const published = publisher.lastPublishedProcessingQueued;
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

    expect(publisher.publishedProcessingQueued).toHaveLength(1);

    const found = repository.findByProcessingRequestId(
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

    expect(publisher.publishedProcessingQueued).toHaveLength(0);
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

    expect(publisher.publishedProcessingQueued).toHaveLength(1);

    const found = repository.findByProcessingRequestId(
      request.processingRequestId,
    );
    expect(found?.status).toBe(ProcessingRequestStatus.QUEUED);
    expect(found?.attemptId).toBeDefined();
  });

  it('propagates publication failure without marking the event processed', async () => {
    const request = await createRequest();
    publisher.publishProcessingQueued = () => {
      throw new Error('broker down');
    };

    await expect(
      useCase.execute({
        eventId: 'accepted-event-6',
        processingRequestId: request.processingRequestId,
        occurredAt: new Date().toISOString(),
      }),
    ).rejects.toThrow('broker down');

    expect(repository.hasEventBeenProcessed('accepted-event-6')).toBe(false);
  });
});
