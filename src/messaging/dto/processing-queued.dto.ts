export interface ProcessingQueuedDto {
  eventId: string;
  processingRequestId: string;
  ownerUserId: string;
  sourceStorageKey: string;
  attemptId: string;
  occurredAt: string;
  /** Omitted, never null, when the request has none. */
  correlationId?: string;
}
