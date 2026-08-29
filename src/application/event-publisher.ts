import {
  ProcessingQueuedDto,
  TerminalEventDto,
  VideoValidationRequestedDto,
} from '../messaging/dto';

export type VideoValidationRequestedEvent = VideoValidationRequestedDto;

export interface EventPublisher {
  publishVideoValidationRequested(
    event: VideoValidationRequestedDto,
  ): void | Promise<void>;
  publishProcessingQueued(event: ProcessingQueuedDto): void | Promise<void>;
  publishTerminalEvent(event: TerminalEventDto): void | Promise<void>;
}
