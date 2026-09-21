import { ProcessingRequestStatus } from '../domain/processing-request';
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

    publisher.publishVideoValidationRequested(event);

    expect(publisher.lastPublished).toEqual(event);
    expect(publisher.published).toHaveLength(1);
    expect(publisher.published[0]).toEqual(event);
  });

  it('records a published ProcessingQueued event', () => {
    const publisher = new InMemoryEventPublisher();
    const event = {
      eventId: 'event-123',
      processingRequestId: 'req-123',
      ownerUserId: 'user-123',
      sourceStorageKey: 'videos/input.mp4',
      attemptId: 'attempt-123',
      occurredAt: new Date().toISOString(),
    };

    publisher.publishProcessingQueued(event);

    expect(publisher.lastPublishedProcessingQueued).toEqual(event);
    expect(publisher.publishedProcessingQueued).toHaveLength(1);
    expect(publisher.publishedProcessingQueued[0]).toEqual(event);
  });

  it('records a published TerminalEvent event', () => {
    const publisher = new InMemoryEventPublisher();
    const event = {
      eventId: 'event-123',
      processingRequestId: 'req-123',
      ownerUserId: 'user-123',
      status: ProcessingRequestStatus.COMPLETED,
      zipStorageKey: 'zips/output.zip',
      occurredAt: new Date().toISOString(),
    };

    publisher.publishTerminalEvent(event);

    expect(publisher.lastPublishedTerminalEvent).toEqual(event);
    expect(publisher.publishedTerminalEvents).toHaveLength(1);
    expect(publisher.publishedTerminalEvents[0]).toEqual(event);
  });

  it('starts with no published events', () => {
    const publisher = new InMemoryEventPublisher();

    expect(publisher.lastPublished).toBeUndefined();
    expect(publisher.published).toHaveLength(0);
    expect(publisher.lastPublishedProcessingQueued).toBeUndefined();
    expect(publisher.publishedProcessingQueued).toHaveLength(0);
    expect(publisher.lastPublishedTerminalEvent).toBeUndefined();
    expect(publisher.publishedTerminalEvents).toHaveLength(0);
  });
});
