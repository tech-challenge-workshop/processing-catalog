import {
  EventPublisher,
  VideoValidationRequestedEvent,
} from '../application/event-publisher';
import { ProcessingQueuedDto, TerminalEventDto } from '../messaging/dto';

export type { VideoValidationRequestedEvent } from '../application/event-publisher';

export class InMemoryEventPublisher implements EventPublisher {
  published: VideoValidationRequestedEvent[] = [];
  publishedProcessingQueued: ProcessingQueuedDto[] = [];
  publishedTerminalEvents: TerminalEventDto[] = [];

  publishVideoValidationRequested(event: VideoValidationRequestedEvent): void {
    this.published.push(event);
  }

  publishProcessingQueued(event: ProcessingQueuedDto): void {
    this.publishedProcessingQueued.push(event);
  }

  publishTerminalEvent(event: TerminalEventDto): void {
    this.publishedTerminalEvents.push(event);
  }

  get lastPublished(): VideoValidationRequestedEvent | undefined {
    return this.published[this.published.length - 1];
  }

  get lastPublishedProcessingQueued(): ProcessingQueuedDto | undefined {
    return this.publishedProcessingQueued[
      this.publishedProcessingQueued.length - 1
    ];
  }

  get lastPublishedTerminalEvent(): TerminalEventDto | undefined {
    return this.publishedTerminalEvents[
      this.publishedTerminalEvents.length - 1
    ];
  }
}
