export interface ProcessingStartedDto {
  eventId: string;
  processingRequestId: string;
  attemptId: string;
  occurredAt: string;
}
