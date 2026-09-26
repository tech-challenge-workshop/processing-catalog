import {
  InMemoryOutboxWriter,
  InMemoryUnitOfWork,
} from '../in-memory-unit-of-work';
import { AcceptProcessingRequestUseCase } from '../../application/accept-processing-request.use-case';
import { CompleteProcessingRequestUseCase } from '../../application/complete-processing-request.use-case';
import { CreateProcessingRequestUseCase } from '../../application/create-processing-request.use-case';
import {
  ProcessingRequestDomainError,
  startProcessingRequest,
} from '../../domain/processing-request';
import { InMemoryProcessingRequestRepository } from '../in-memory-processing-request.repository';
import { ProcessingCompletedConsumer } from './processing-completed.consumer';

describe('ProcessingCompletedConsumer', () => {
  let repository: InMemoryProcessingRequestRepository;
  let outbox: InMemoryOutboxWriter;
  let unitOfWork: InMemoryUnitOfWork;
  let useCase: CompleteProcessingRequestUseCase;
  let consumer: ProcessingCompletedConsumer;

  beforeEach(() => {
    repository = new InMemoryProcessingRequestRepository();
    outbox = new InMemoryOutboxWriter();
    unitOfWork = new InMemoryUnitOfWork(repository, outbox);
    useCase = new CompleteProcessingRequestUseCase(repository, unitOfWork);
    consumer = new ProcessingCompletedConsumer({} as never, useCase);
  });

  const createQueuedRequest = async () => {
    const createUseCase = new CreateProcessingRequestUseCase(
      repository,
      unitOfWork,
    );
    const { request } = await createUseCase.execute({
      eventId: 'create-event-1',
      ownerUserId: 'user-123',
      sourceStorageKey: 'videos/input.mp4',
      idempotencyKey: 'create-key-1',
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

    // Completion now requires PROCESSING. The start consumer arrives in T11;
    // until then the transition is applied through the domain directly.
    const processing = startProcessingRequest(queued);
    await repository.update(processing);
    return processing;
  };

  it('processes a valid ProcessingCompleted event', async () => {
    const request = await createQueuedRequest();
    const content = JSON.stringify({
      eventId: 'processing-completed-1',
      processingRequestId: request.processingRequestId,
      zipStorageKey: 'zips/output.zip',
      occurredAt: new Date().toISOString(),
    });

    await consumer.handleMessage(content);

    const found = await repository.findByProcessingRequestId(
      request.processingRequestId,
    );
    expect(found?.status).toBe('COMPLETED');
    expect(outbox.recordedTerminalEvents).toHaveLength(1);
  });

  it('is idempotent for the same eventId', async () => {
    const request = await createQueuedRequest();
    const content = JSON.stringify({
      eventId: 'processing-completed-2',
      processingRequestId: request.processingRequestId,
      zipStorageKey: 'zips/output.zip',
      occurredAt: new Date().toISOString(),
    });

    await consumer.handleMessage(content);
    await consumer.handleMessage(content);

    expect(outbox.recordedTerminalEvents).toHaveLength(1);
  });

  it('rejects an invalid payload', async () => {
    const content = JSON.stringify({ eventId: 'processing-completed-3' });

    await expect(consumer.handleMessage(content)).rejects.toBeInstanceOf(
      ProcessingRequestDomainError,
    );

    expect(outbox.recordedTerminalEvents).toHaveLength(0);
  });

  it('rejects an unsupported transition', async () => {
    const request = await createQueuedRequest();
    await consumer.handleMessage(
      JSON.stringify({
        eventId: 'processing-completed-4',
        processingRequestId: request.processingRequestId,
        zipStorageKey: 'zips/output.zip',
        occurredAt: new Date().toISOString(),
      }),
    );

    await expect(
      consumer.handleMessage(
        JSON.stringify({
          eventId: 'processing-completed-5',
          processingRequestId: request.processingRequestId,
          zipStorageKey: 'zips/output2.zip',
          occurredAt: new Date().toISOString(),
        }),
      ),
    ).rejects.toBeInstanceOf(ProcessingRequestDomainError);

    expect(outbox.recordedTerminalEvents).toHaveLength(1);
  });

  it('propagates publication failures', async () => {
    const request = await createQueuedRequest();
    outbox.add = () => Promise.reject(new Error('outbox write failed'));

    await expect(
      consumer.handleMessage(
        JSON.stringify({
          eventId: 'processing-completed-6',
          processingRequestId: request.processingRequestId,
          zipStorageKey: 'zips/output.zip',
          occurredAt: new Date().toISOString(),
        }),
      ),
    ).rejects.toThrow('outbox write failed');
  });
});
