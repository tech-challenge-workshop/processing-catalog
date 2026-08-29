import { AcceptProcessingRequestUseCase } from '../../application/accept-processing-request.use-case';
import { CompleteProcessingRequestUseCase } from '../../application/complete-processing-request.use-case';
import { CreateProcessingRequestUseCase } from '../../application/create-processing-request.use-case';
import { ProcessingRequestDomainError } from '../../domain/processing-request';
import { InMemoryEventPublisher } from '../in-memory-event-publisher';
import { InMemoryProcessingRequestRepository } from '../in-memory-processing-request.repository';
import { ProcessingCompletedConsumer } from './processing-completed.consumer';

describe('ProcessingCompletedConsumer', () => {
  let repository: InMemoryProcessingRequestRepository;
  let publisher: InMemoryEventPublisher;
  let useCase: CompleteProcessingRequestUseCase;
  let consumer: ProcessingCompletedConsumer;

  beforeEach(() => {
    repository = new InMemoryProcessingRequestRepository();
    publisher = new InMemoryEventPublisher();
    useCase = new CompleteProcessingRequestUseCase(repository, publisher);
    consumer = new ProcessingCompletedConsumer({} as never, useCase);
  });

  const createQueuedRequest = async () => {
    const createUseCase = new CreateProcessingRequestUseCase(
      repository,
      publisher,
    );
    const request = await createUseCase.execute({
      eventId: 'create-event-1',
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

  it('processes a valid ProcessingCompleted event', async () => {
    const request = await createQueuedRequest();
    const content = JSON.stringify({
      eventId: 'processing-completed-1',
      processingRequestId: request.processingRequestId,
      zipStorageKey: 'zips/output.zip',
      occurredAt: new Date().toISOString(),
    });

    await consumer.handleMessage(content);

    const found = repository.findByProcessingRequestId(
      request.processingRequestId,
    );
    expect(found?.status).toBe('COMPLETED');
    expect(publisher.publishedTerminalEvents).toHaveLength(1);
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

    expect(publisher.publishedTerminalEvents).toHaveLength(1);
  });

  it('rejects an invalid payload', async () => {
    const content = JSON.stringify({ eventId: 'processing-completed-3' });

    await expect(consumer.handleMessage(content)).rejects.toBeInstanceOf(
      ProcessingRequestDomainError,
    );

    expect(publisher.publishedTerminalEvents).toHaveLength(0);
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

    expect(publisher.publishedTerminalEvents).toHaveLength(1);
  });

  it('propagates publication failures', async () => {
    const request = await createQueuedRequest();
    publisher.publishTerminalEvent = () => {
      throw new Error('broker down');
    };

    await expect(
      consumer.handleMessage(
        JSON.stringify({
          eventId: 'processing-completed-6',
          processingRequestId: request.processingRequestId,
          zipStorageKey: 'zips/output.zip',
          occurredAt: new Date().toISOString(),
        }),
      ),
    ).rejects.toThrow('broker down');
  });
});
