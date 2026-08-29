import { InMemoryProcessingRequestRepository } from '../infrastructure/in-memory-processing-request.repository';
import { InMemoryEventPublisher } from '../infrastructure/in-memory-event-publisher';
import { CreateProcessingRequestUseCase } from './create-processing-request.use-case';
import { ProcessingRequestStatus } from '../domain/processing-request';

describe('CreateProcessingRequestUseCase', () => {
  let repository: InMemoryProcessingRequestRepository;
  let publisher: InMemoryEventPublisher;
  let useCase: CreateProcessingRequestUseCase;

  beforeEach(() => {
    repository = new InMemoryProcessingRequestRepository();
    publisher = new InMemoryEventPublisher();
    useCase = new CreateProcessingRequestUseCase(repository, publisher);
  });

  it('creates a request in RECEIVED state and publishes VideoValidationRequested', async () => {
    const request = await useCase.execute({
      eventId: 'event-123',
      ownerUserId: 'user-123',
      sourceStorageKey: 'videos/input.mp4',
    });

    expect(request.status).toBe(ProcessingRequestStatus.RECEIVED);
    expect(request.ownerUserId).toBe('user-123');
    expect(request.sourceStorageKey).toBe('videos/input.mp4');

    const published = publisher.lastPublished;
    expect(published).toBeDefined();
    expect(published!.eventId).toBe('event-123');
    expect(published!.processingRequestId).toBe(request.processingRequestId);
    expect(published!.ownerUserId).toBe('user-123');
    expect(published!.sourceStorageKey).toBe('videos/input.mp4');
    expect(published!.occurredAt).toBe(request.createdAt.toISOString());
  });

  it('is idempotent for a repeated eventId', async () => {
    const input = {
      eventId: 'event-456',
      ownerUserId: 'user-456',
      sourceStorageKey: 'videos/another.mp4',
    };

    const firstRequest = await useCase.execute(input);
    const secondRequest = await useCase.execute(input);

    expect(firstRequest.processingRequestId).toBe(
      secondRequest.processingRequestId,
    );
    expect(publisher.published).toHaveLength(1);
  });

  it('rejects missing ownerUserId without persisting or publishing', async () => {
    await expect(
      useCase.execute({
        eventId: 'event-789',
        ownerUserId: '',
        sourceStorageKey: 'videos/input.mp4',
      }),
    ).rejects.toThrow('ownerUserId is required');

    expect(publisher.published).toHaveLength(0);
    expect(repository.findByEventId('event-789')).toBeUndefined();
  });

  it('rejects missing sourceStorageKey without persisting or publishing', async () => {
    await expect(
      useCase.execute({
        eventId: 'event-abc',
        ownerUserId: 'user-abc',
        sourceStorageKey: '',
      }),
    ).rejects.toThrow('sourceStorageKey is required');

    expect(publisher.published).toHaveLength(0);
    expect(repository.findByEventId('event-abc')).toBeUndefined();
  });
});
