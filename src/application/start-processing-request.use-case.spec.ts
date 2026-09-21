import {
  InMemoryOutboxWriter,
  InMemoryUnitOfWork,
} from '../infrastructure/in-memory-unit-of-work';
import { randomUUID } from 'crypto';
import { ProcessingRequestStatus } from '../domain/processing-request';
import { InMemoryProcessingRequestRepository } from '../infrastructure/in-memory-processing-request.repository';
import { AcceptProcessingRequestUseCase } from './accept-processing-request.use-case';
import { CreateProcessingRequestUseCase } from './create-processing-request.use-case';
import { StartProcessingRequestUseCase } from './start-processing-request.use-case';

describe('StartProcessingRequestUseCase', () => {
  let repository: InMemoryProcessingRequestRepository;
  let outbox: InMemoryOutboxWriter;
  let unitOfWork: InMemoryUnitOfWork;
  let useCase: StartProcessingRequestUseCase;

  beforeEach(() => {
    repository = new InMemoryProcessingRequestRepository();
    outbox = new InMemoryOutboxWriter();
    unitOfWork = new InMemoryUnitOfWork(repository, outbox);
    useCase = new StartProcessingRequestUseCase(repository, unitOfWork);
  });

  const queuedRequest = async () => {
    const created = await new CreateProcessingRequestUseCase(
      repository,
      unitOfWork,
    ).execute({
      eventId: randomUUID(),
      ownerUserId: 'user-123',
      sourceStorageKey: 'videos/input.mp4',
    });
    return new AcceptProcessingRequestUseCase(repository, unitOfWork).execute({
      eventId: 'accept-1',
      processingRequestId: created.processingRequestId,
      occurredAt: new Date().toISOString(),
    });
  };

  it('transitions QUEUED to PROCESSING and publishes no terminal event', async () => {
    const request = await queuedRequest();
    const before = outbox.recordedTerminalEvents.length;

    const updated = await useCase.execute({
      eventId: 'started-1',
      processingRequestId: request.processingRequestId,
      occurredAt: new Date().toISOString(),
    });

    expect(updated.status).toBe(ProcessingRequestStatus.PROCESSING);
    expect(
      (await repository.findByProcessingRequestId(request.processingRequestId))
        ?.status,
    ).toBe(ProcessingRequestStatus.PROCESSING);
    expect(outbox.recordedTerminalEvents).toHaveLength(before);
  });

  it('keeps the attemptId assigned when the request was queued', async () => {
    const request = await queuedRequest();

    const updated = await useCase.execute({
      eventId: 'started-1',
      processingRequestId: request.processingRequestId,
      occurredAt: new Date().toISOString(),
    });

    expect(updated.attemptId).toBe(request.attemptId);
  });

  it('applies no second transition for a repeated eventId', async () => {
    const request = await queuedRequest();
    const input = {
      eventId: 'started-1',
      processingRequestId: request.processingRequestId,
      occurredAt: new Date().toISOString(),
    };

    const first = await useCase.execute(input);
    const second = await useCase.execute(input);

    expect(second.processingRequestId).toBe(first.processingRequestId);
    expect(second.status).toBe(ProcessingRequestStatus.PROCESSING);
  });

  it('rejects an unknown processingRequestId and creates no request', async () => {
    await expect(
      useCase.execute({
        eventId: 'started-1',
        processingRequestId: 'does-not-exist',
        occurredAt: new Date().toISOString(),
      }),
    ).rejects.toThrow('Processing request does-not-exist not found');

    expect(
      await repository.findByProcessingRequestId('does-not-exist'),
    ).toBeUndefined();
  });

  it('rejects a start from RECEIVED and leaves the stored state unchanged', async () => {
    const created = await new CreateProcessingRequestUseCase(
      repository,
      unitOfWork,
    ).execute({
      eventId: randomUUID(),
      ownerUserId: 'user-123',
      sourceStorageKey: 'videos/input.mp4',
    });

    await expect(
      useCase.execute({
        eventId: 'started-1',
        processingRequestId: created.processingRequestId,
        occurredAt: new Date().toISOString(),
      }),
    ).rejects.toThrow('Cannot start request in RECEIVED status');

    expect(
      (await repository.findByProcessingRequestId(created.processingRequestId))
        ?.status,
    ).toBe(ProcessingRequestStatus.RECEIVED);
  });

  it('rejects a missing eventId', async () => {
    await expect(
      useCase.execute({
        eventId: '',
        processingRequestId: 'req-1',
        occurredAt: new Date().toISOString(),
      }),
    ).rejects.toThrow('eventId is required');
  });
});
