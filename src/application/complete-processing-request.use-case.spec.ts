import {
  InMemoryOutboxWriter,
  InMemoryUnitOfWork,
} from '../infrastructure/in-memory-unit-of-work';
import { randomUUID } from 'crypto';
import {
  ProcessingRequestStatus,
  startProcessingRequest,
} from '../domain/processing-request';
import { InMemoryProcessingRequestRepository } from '../infrastructure/in-memory-processing-request.repository';
import { AcceptProcessingRequestUseCase } from './accept-processing-request.use-case';
import { CompleteProcessingRequestUseCase } from './complete-processing-request.use-case';
import { CreateProcessingRequestUseCase } from './create-processing-request.use-case';

describe('CompleteProcessingRequestUseCase', () => {
  let repository: InMemoryProcessingRequestRepository;
  let outbox: InMemoryOutboxWriter;
  let unitOfWork: InMemoryUnitOfWork;
  let useCase: CompleteProcessingRequestUseCase;

  beforeEach(() => {
    repository = new InMemoryProcessingRequestRepository();
    outbox = new InMemoryOutboxWriter();
    unitOfWork = new InMemoryUnitOfWork(repository, outbox);
    useCase = new CompleteProcessingRequestUseCase(repository, unitOfWork);
  });

  const createQueuedRequest = async () => {
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
    const acceptUseCase = new AcceptProcessingRequestUseCase(
      repository,
      unitOfWork,
    );
    const queued = await acceptUseCase.execute({
      eventId: 'accept-event-1',
      processingRequestId: request.processingRequestId,
      occurredAt: new Date().toISOString(),
    });

    // Completion now requires PROCESSING. The start use case arrives in T7;
    // until then the transition is applied through the domain directly.
    const processing = startProcessingRequest(queued);
    await repository.update(processing);
    return processing;
  };

  it('transitions a request from QUEUED to COMPLETED and publishes TerminalEvent', async () => {
    const request = await createQueuedRequest();
    const eventId = 'completed-event-1';
    const occurredAt = new Date().toISOString();

    const updated = await useCase.execute({
      eventId,
      processingRequestId: request.processingRequestId,
      zipStorageKey: 'zips/output.zip',
      occurredAt,
    });

    expect(updated.status).toBe(ProcessingRequestStatus.COMPLETED);
    expect(updated.zipStorageKey).toBe('zips/output.zip');

    const found = await repository.findByProcessingRequestId(
      request.processingRequestId,
    );
    expect(found?.status).toBe(ProcessingRequestStatus.COMPLETED);

    expect(outbox.recordedTerminalEvents).toHaveLength(1);
    const published = outbox.recordedTerminalEvents.at(-1);
    expect(published?.processingRequestId).toBe(request.processingRequestId);
    expect(published?.ownerUserId).toBe('user-123');
    expect(published?.status).toBe(ProcessingRequestStatus.COMPLETED);
    expect(published?.zipStorageKey).toBe('zips/output.zip');
    expect(published?.occurredAt).toBe(occurredAt);
  });

  it('is idempotent for a repeated eventId', async () => {
    const request = await createQueuedRequest();
    const eventId = 'completed-event-2';

    await useCase.execute({
      eventId,
      processingRequestId: request.processingRequestId,
      zipStorageKey: 'zips/output.zip',
      occurredAt: new Date().toISOString(),
    });

    await useCase.execute({
      eventId,
      processingRequestId: request.processingRequestId,
      zipStorageKey: 'zips/output.zip',
      occurredAt: new Date().toISOString(),
    });

    expect(outbox.recordedTerminalEvents).toHaveLength(1);

    const found = await repository.findByProcessingRequestId(
      request.processingRequestId,
    );
    expect(found?.status).toBe(ProcessingRequestStatus.COMPLETED);
  });

  it('rejects an event without processingRequestId', async () => {
    await expect(
      useCase.execute({
        eventId: 'completed-event-3',
        processingRequestId: '',
        zipStorageKey: 'zips/output.zip',
        occurredAt: new Date().toISOString(),
      }),
    ).rejects.toThrow('processingRequestId is required');

    expect(outbox.recordedTerminalEvents).toHaveLength(0);
  });

  it('rejects an event without zipStorageKey', async () => {
    const request = await createQueuedRequest();

    await expect(
      useCase.execute({
        eventId: 'completed-event-4',
        processingRequestId: request.processingRequestId,
        zipStorageKey: '',
        occurredAt: new Date().toISOString(),
      }),
    ).rejects.toThrow('zipStorageKey is required');

    expect(outbox.recordedTerminalEvents).toHaveLength(0);
  });

  it('rejects an unsupported transition without publishing or changing state', async () => {
    const request = await createQueuedRequest();
    await useCase.execute({
      eventId: 'completed-event-5',
      processingRequestId: request.processingRequestId,
      zipStorageKey: 'zips/output.zip',
      occurredAt: new Date().toISOString(),
    });

    await expect(
      useCase.execute({
        eventId: 'completed-event-6',
        processingRequestId: request.processingRequestId,
        zipStorageKey: 'zips/output2.zip',
        occurredAt: new Date().toISOString(),
      }),
    ).rejects.toThrow('Cannot complete request in COMPLETED status');

    expect(outbox.recordedTerminalEvents).toHaveLength(1);

    const found = await repository.findByProcessingRequestId(
      request.processingRequestId,
    );
    expect(found?.status).toBe(ProcessingRequestStatus.COMPLETED);
    expect(found?.zipStorageKey).toBe('zips/output.zip');
  });

  it('propagates an outbox write failure without marking the event processed', async () => {
    const request = await createQueuedRequest();
    outbox.add = () => Promise.reject(new Error('outbox write failed'));

    await expect(
      useCase.execute({
        eventId: 'completed-event-7',
        processingRequestId: request.processingRequestId,
        zipStorageKey: 'zips/output.zip',
        occurredAt: new Date().toISOString(),
      }),
    ).rejects.toThrow('outbox write failed');

    expect(await repository.hasEventBeenProcessed('completed-event-7')).toBe(
      false,
    );
  });
});
