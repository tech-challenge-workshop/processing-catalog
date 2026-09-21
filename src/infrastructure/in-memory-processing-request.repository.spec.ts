import {
  acceptProcessingRequest,
  createProcessingRequest,
} from '../domain/processing-request';
import { InMemoryProcessingRequestRepository } from './in-memory-processing-request.repository';

describe('InMemoryProcessingRequestRepository', () => {
  let repository: InMemoryProcessingRequestRepository;

  beforeEach(() => {
    repository = new InMemoryProcessingRequestRepository();
  });

  it('saves a request and finds it by processingRequestId', async () => {
    const request = createProcessingRequest({
      ownerUserId: 'user-123',
      sourceStorageKey: 'videos/input.mp4',
    });

    await repository.save(request);

    const found = await repository.findByProcessingRequestId(
      request.processingRequestId,
    );
    expect(found).toEqual(request);
  });

  it('updates a request in place', async () => {
    const request = createProcessingRequest({
      ownerUserId: 'user-123',
      sourceStorageKey: 'videos/input.mp4',
    });
    await repository.save(request);

    const updated = acceptProcessingRequest(request);
    await repository.update(updated);

    const found = await repository.findByProcessingRequestId(
      request.processingRequestId,
    );
    expect(found).toEqual(updated);
    expect(found?.status).toBe('QUEUED');
  });

  it('returns undefined when processingRequestId is not found', async () => {
    const found = await repository.findByProcessingRequestId('non-existent-id');
    expect(found).toBeUndefined();
  });

  it('tracks a processed eventId and detects duplicates', async () => {
    const eventId = 'event-123';

    expect(await repository.hasEventBeenProcessed(eventId)).toBe(false);

    await repository.markEventProcessed(eventId);

    expect(await repository.hasEventBeenProcessed(eventId)).toBe(true);
  });

  it('finds a request saved under a given eventId', async () => {
    const eventId = 'event-456';
    const request = createProcessingRequest({
      ownerUserId: 'user-456',
      sourceStorageKey: 'videos/another.mp4',
    });

    await repository.save(request);
    await repository.markEventProcessed(eventId, request.processingRequestId);

    const found = await repository.findByEventId(eventId);
    expect(found).toEqual(request);
  });

  it('returns undefined when eventId is not found', async () => {
    const found = await repository.findByEventId('non-existent-event');
    expect(found).toBeUndefined();
  });
});
