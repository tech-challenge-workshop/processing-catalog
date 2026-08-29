import { randomUUID } from 'crypto';
import { ProcessingRequestStatus } from '../domain/processing-request';
import { InMemoryProcessingRequestRepository } from '../infrastructure/in-memory-processing-request.repository';
import { InMemoryEventPublisher } from '../infrastructure/in-memory-event-publisher';
import { AcceptProcessingRequestUseCase } from './accept-processing-request.use-case';
import { CompleteProcessingRequestUseCase } from './complete-processing-request.use-case';
import { CreateProcessingRequestUseCase } from './create-processing-request.use-case';

describe('CompleteProcessingRequestUseCase', () => {
  let repository: InMemoryProcessingRequestRepository;
  let publisher: InMemoryEventPublisher;
  let useCase: CompleteProcessingRequestUseCase;

  beforeEach(() => {
    repository = new InMemoryProcessingRequestRepository();
    publisher = new InMemoryEventPublisher();
    useCase = new CompleteProcessingRequestUseCase(repository, publisher);
  });

  const createQueuedRequest = () => {
    const createUseCase = new CreateProcessingRequestUseCase(
      repository,
      publisher,
    );
    const request = createUseCase.execute({
      eventId: randomUUID(),
      ownerUserId: 'user-123',
      sourceStorageKey: 'videos/input.mp4',
    });
    const acceptUseCase = new AcceptProcessingRequestUseCase(
      repository,
      publisher,
    );
    return acceptUseCase.execute({
      eventId: 'accept-event-1',
      processingRequestId: request.processingRequestId,
      occurredAt: new Date().toISOString(),
    });
  };

  it('transitions a request from QUEUED to COMPLETED and publishes TerminalEvent', () => {
    const request = createQueuedRequest();
    const eventId = 'completed-event-1';
    const occurredAt = new Date().toISOString();

    const updated = useCase.execute({
      eventId,
      processingRequestId: request.processingRequestId,
      zipStorageKey: 'zips/output.zip',
      occurredAt,
    });

    expect(updated.status).toBe(ProcessingRequestStatus.COMPLETED);
    expect(updated.zipStorageKey).toBe('zips/output.zip');

    const found = repository.findByProcessingRequestId(
      request.processingRequestId,
    );
    expect(found?.status).toBe(ProcessingRequestStatus.COMPLETED);

    expect(publisher.publishedTerminalEvents).toHaveLength(1);
    const published = publisher.lastPublishedTerminalEvent;
    expect(published?.processingRequestId).toBe(request.processingRequestId);
    expect(published?.ownerUserId).toBe('user-123');
    expect(published?.status).toBe(ProcessingRequestStatus.COMPLETED);
    expect(published?.zipStorageKey).toBe('zips/output.zip');
    expect(published?.occurredAt).toBe(occurredAt);
  });

  it('is idempotent for a repeated eventId', () => {
    const request = createQueuedRequest();
    const eventId = 'completed-event-2';

    useCase.execute({
      eventId,
      processingRequestId: request.processingRequestId,
      zipStorageKey: 'zips/output.zip',
      occurredAt: new Date().toISOString(),
    });

    useCase.execute({
      eventId,
      processingRequestId: request.processingRequestId,
      zipStorageKey: 'zips/output.zip',
      occurredAt: new Date().toISOString(),
    });

    expect(publisher.publishedTerminalEvents).toHaveLength(1);

    const found = repository.findByProcessingRequestId(
      request.processingRequestId,
    );
    expect(found?.status).toBe(ProcessingRequestStatus.COMPLETED);
  });

  it('rejects an event without processingRequestId', () => {
    expect(() =>
      useCase.execute({
        eventId: 'completed-event-3',
        processingRequestId: '',
        zipStorageKey: 'zips/output.zip',
        occurredAt: new Date().toISOString(),
      }),
    ).toThrow('processingRequestId is required');

    expect(publisher.publishedTerminalEvents).toHaveLength(0);
  });

  it('rejects an event without zipStorageKey', () => {
    const request = createQueuedRequest();

    expect(() =>
      useCase.execute({
        eventId: 'completed-event-4',
        processingRequestId: request.processingRequestId,
        zipStorageKey: '',
        occurredAt: new Date().toISOString(),
      }),
    ).toThrow('zipStorageKey is required');

    expect(publisher.publishedTerminalEvents).toHaveLength(0);
  });

  it('rejects an unsupported transition without publishing or changing state', () => {
    const request = createQueuedRequest();
    useCase.execute({
      eventId: 'completed-event-5',
      processingRequestId: request.processingRequestId,
      zipStorageKey: 'zips/output.zip',
      occurredAt: new Date().toISOString(),
    });

    expect(() =>
      useCase.execute({
        eventId: 'completed-event-6',
        processingRequestId: request.processingRequestId,
        zipStorageKey: 'zips/output2.zip',
        occurredAt: new Date().toISOString(),
      }),
    ).toThrow('Cannot complete request in COMPLETED status');

    expect(publisher.publishedTerminalEvents).toHaveLength(1);

    const found = repository.findByProcessingRequestId(
      request.processingRequestId,
    );
    expect(found?.status).toBe(ProcessingRequestStatus.COMPLETED);
    expect(found?.zipStorageKey).toBe('zips/output.zip');
  });

  it('propagates publication failure without marking the event processed', () => {
    const request = createQueuedRequest();
    publisher.publishTerminalEvent = () => {
      throw new Error('broker down');
    };

    expect(() =>
      useCase.execute({
        eventId: 'completed-event-7',
        processingRequestId: request.processingRequestId,
        zipStorageKey: 'zips/output.zip',
        occurredAt: new Date().toISOString(),
      }),
    ).toThrow('broker down');

    expect(repository.hasEventBeenProcessed('completed-event-7')).toBe(false);
  });
});
