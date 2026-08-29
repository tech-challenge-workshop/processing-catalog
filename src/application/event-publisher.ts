import {
  ProcessingQueuedDto,
  TerminalEventDto,
  VideoValidationRequestedDto,
} from '../messaging/dto';

export type VideoValidationRequestedEvent = VideoValidationRequestedDto;

export interface EventPublisher {
  publishVideoValidationRequested(event: VideoValidationRequestedDto): void;
  publishProcessingQueued(event: ProcessingQueuedDto): void;
  publishTerminalEvent(event: TerminalEventDto): void;
}
