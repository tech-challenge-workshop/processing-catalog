import {
  EventPublisher,
  VideoValidationRequestedEvent,
} from '../application/event-publisher';

export { VideoValidationRequestedEvent } from '../application/event-publisher';

export class InMemoryEventPublisher implements EventPublisher {
  published: VideoValidationRequestedEvent[] = [];

  publish(event: VideoValidationRequestedEvent): void {
    this.published.push(event);
  }

  get lastPublished(): VideoValidationRequestedEvent | undefined {
    return this.published[this.published.length - 1];
  }
}
