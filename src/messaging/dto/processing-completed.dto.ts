export interface ProcessingCompletedDto {
  eventId: string;
  processingRequestId: string;
  attemptId: string;
  zipStorageKey: string;
  occurredAt: string;
  /**
   * The pipeline's trace id. Optional: absent or invalid, the consumer
   * generates one for its log context and still handles the message.
   */
  correlationId?: string;
}
