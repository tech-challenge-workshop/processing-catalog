import { AcceptProcessingRequestUseCase } from '../../application/accept-processing-request.use-case';
import { CreateProcessingRequestUseCase } from '../../application/create-processing-request.use-case';
import { ProcessingRequestDomainError } from '../../domain/processing-request';
import { InMemoryEventPublisher } from '../in-memory-event-publisher';
import { InMemoryProcessingRequestRepository } from '../in-memory-processing-request.repository';
import { VideoAcceptedConsumer } from './video-accepted.consumer';

describe('VideoAcceptedConsumer', () => {
  let repository: InMemoryProcessingRequestRepository;
  let publisher: InMemoryEventPublisher;
  let useCase: AcceptProcessingRequestUseCase;
  let consumer: VideoAcceptedConsumer;

  beforeEach(() => {
    repository = new InMemoryProcessingRequestRepository();
    publisher = new InMemoryEventPublisher();
    useCase = new AcceptProcessingRequestUseCase(repository, publisher);
    consumer = new VideoAcceptedConsumer({} as never, useCase);
  });

  const createRequest = async () => {
    const createUseCase = new CreateProcessingRequestUseCase(
      repository,
      publisher,
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
    expect(publisher.publishedProcessingQueued).toHaveLength(1);
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

    expect(publisher.publishedProcessingQueued).toHaveLength(1);
  });

  it('rejects an invalid payload', async () => {
    const content = JSON.stringify({ eventId: 'video-accepted-3' });

    await expect(consumer.handleMessage(content)).rejects.toBeInstanceOf(
      ProcessingRequestDomainError,
    );

    expect(publisher.publishedProcessingQueued).toHaveLength(0);
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

    expect(publisher.publishedProcessingQueued).toHaveLength(1);
  });

  it('propagates publication failures', async () => {
    const request = await createRequest();
    publisher.publishProcessingQueued = () => {
      throw new Error('broker down');
    };

    await expect(
      consumer.handleMessage(
        JSON.stringify({
          eventId: 'video-accepted-6',
          processingRequestId: request.processingRequestId,
          occurredAt: new Date().toISOString(),
        }),
      ),
    ).rejects.toThrow('broker down');
  });
});
