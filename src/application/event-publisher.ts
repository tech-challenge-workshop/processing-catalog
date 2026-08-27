export interface VideoValidationRequestedEvent {
  eventId: string;
  processingRequestId: string;
  ownerUserId: string;
  sourceStorageKey: string;
  occurredAt: string;
}

export interface EventPublisher {
  publish(event: VideoValidationRequestedEvent): void;
}
