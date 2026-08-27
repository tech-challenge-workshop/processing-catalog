import {
  InMemoryEventPublisher,
  VideoValidationRequestedEvent,
} from './in-memory-event-publisher';

describe('InMemoryEventPublisher', () => {
  it('records a published VideoValidationRequested event', () => {
    const publisher = new InMemoryEventPublisher();
    const event: VideoValidationRequestedEvent = {
      eventId: 'event-123',
      processingRequestId: 'req-123',
      ownerUserId: 'user-123',
      sourceStorageKey: 'videos/input.mp4',
      occurredAt: new Date().toISOString(),
    };

    publisher.publish(event);

    expect(publisher.lastPublished).toEqual(event);
    expect(publisher.published).toHaveLength(1);
    expect(publisher.published[0]).toEqual(event);
  });

  it('starts with no published events', () => {
    const publisher = new InMemoryEventPublisher();

    expect(publisher.lastPublished).toBeUndefined();
    expect(publisher.published).toHaveLength(0);
  });
});
