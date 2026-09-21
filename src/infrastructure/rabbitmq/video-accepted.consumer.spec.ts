import {
  InMemoryOutboxWriter,
  InMemoryUnitOfWork,
} from '../in-memory-unit-of-work';
import { AcceptProcessingRequestUseCase } from '../../application/accept-processing-request.use-case';
import { CreateProcessingRequestUseCase } from '../../application/create-processing-request.use-case';
import { ProcessingRequestDomainError } from '../../domain/processing-request';
import { InMemoryProcessingRequestRepository } from '../in-memory-processing-request.repository';
import { VideoAcceptedConsumer } from './video-accepted.consumer';

describe('VideoAcceptedConsumer', () => {
  let repository: InMemoryProcessingRequestRepository;
  let outbox: InMemoryOutboxWriter;
  let unitOfWork: InMemoryUnitOfWork;
  let useCase: AcceptProcessingRequestUseCase;
  let consumer: VideoAcceptedConsumer;

  beforeEach(() => {
    repository = new InMemoryProcessingRequestRepository();
    outbox = new InMemoryOutboxWriter();
    unitOfWork = new InMemoryUnitOfWork(repository, outbox);
    useCase = new AcceptProcessingRequestUseCase(repository, unitOfWork);
    consumer = new VideoAcceptedConsumer({} as never, useCase);
  });

  const createRequest = async () => {
    const createUseCase = new CreateProcessingRequestUseCase(
      repository,
      unitOfWork,
    );
    return createUseCase.execute({
      eventId: 'create-event-1',
      ownerUserId: 'user-123',
      sourceStorageKey: 'videos/input.mp4',
    });
  };

  it('processes a valid VideoAccepted event', async () => {
    const request = await createRequest();
    const content = JSON.stringify({
      eventId: 'video-accepted-1',
      processingRequestId: request.processingRequestId,
      occurredAt: new Date().toISOString(),
    });

    await consumer.handleMessage(content);

    const found = await repository.findByProcessingRequestId(
      request.processingRequestId,
    );
    expect(found?.status).toBe('QUEUED');
    expect(outbox.recordedProcessingQueued).toHaveLength(1);
  });

  it('is idempotent for the same eventId', async () => {
    const request = await createRequest();
    const content = JSON.stringify({
      eventId: 'video-accepted-2',
      processingRequestId: request.processingRequestId,
      occurredAt: new Date().toISOString(),
    });

    await consumer.handleMessage(content);
    await consumer.handleMessage(content);

    expect(outbox.recordedProcessingQueued).toHaveLength(1);
  });

  it('rejects an invalid payload', async () => {
    const content = JSON.stringify({ eventId: 'video-accepted-3' });

    await expect(consumer.handleMessage(content)).rejects.toBeInstanceOf(
      ProcessingRequestDomainError,
    );

    expect(outbox.recordedProcessingQueued).toHaveLength(0);
  });

  it('rejects an unsupported transition', async () => {
    const request = await createRequest();
    await consumer.handleMessage(
      JSON.stringify({
        eventId: 'video-accepted-4',
        processingRequestId: request.processingRequestId,
        occurredAt: new Date().toISOString(),
      }),
    );

    await expect(
      consumer.handleMessage(
        JSON.stringify({
          eventId: 'video-accepted-5',
          processingRequestId: request.processingRequestId,
          occurredAt: new Date().toISOString(),
        }),
      ),
    ).rejects.toBeInstanceOf(ProcessingRequestDomainError);

    expect(outbox.recordedProcessingQueued).toHaveLength(1);
  });

  it('propagates publication failures', async () => {
    const request = await createRequest();
    // The use case no longer publishes: a failure to record the event in the
    // outbox is what must abort the transition now.
    outbox.add = () => Promise.reject(new Error('outbox write failed'));

    await expect(
      consumer.handleMessage(
        JSON.stringify({
          eventId: 'video-accepted-6',
          processingRequestId: request.processingRequestId,
          occurredAt: new Date().toISOString(),
        }),
      ),
    ).rejects.toThrow('outbox write failed');
  });
});
