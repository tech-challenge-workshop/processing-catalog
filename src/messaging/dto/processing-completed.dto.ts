export interface ProcessingCompletedDto {
  eventId: string;
  processingRequestId: string;
  attemptId: string;
  zipStorageKey: string;
  occurredAt: string;
}
