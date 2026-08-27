import { createProcessingRequest } from '../domain/processing-request';
import { InMemoryProcessingRequestRepository } from './in-memory-processing-request.repository';

describe('InMemoryProcessingRequestRepository', () => {
  let repository: InMemoryProcessingRequestRepository;

  beforeEach(() => {
    repository = new InMemoryProcessingRequestRepository();
  });

  it('saves a request and finds it by processingRequestId', () => {
    const request = createProcessingRequest({
      ownerUserId: 'user-123',
      sourceStorageKey: 'videos/input.mp4',
    });

    repository.save(request);

    const found = repository.findByProcessingRequestId(
      request.processingRequestId,
    );
    expect(found).toEqual(request);
  });

  it('returns undefined when processingRequestId is not found', () => {
    const found = repository.findByProcessingRequestId('non-existent-id');
    expect(found).toBeUndefined();
  });

  it('tracks a processed eventId and detects duplicates', () => {
    const eventId = 'event-123';

    expect(repository.hasEventBeenProcessed(eventId)).toBe(false);

    repository.markEventProcessed(eventId);

    expect(repository.hasEventBeenProcessed(eventId)).toBe(true);
  });

  it('finds a request saved under a given eventId', () => {
    const eventId = 'event-456';
    const request = createProcessingRequest({
      ownerUserId: 'user-456',
      sourceStorageKey: 'videos/another.mp4',
    });

    repository.save(request);
    repository.markEventProcessed(eventId, request.processingRequestId);

    const found = repository.findByEventId(eventId);
    expect(found).toEqual(request);
  });

  it('returns undefined when eventId is not found', () => {
    const found = repository.findByEventId('non-existent-event');
    expect(found).toBeUndefined();
  });
});
