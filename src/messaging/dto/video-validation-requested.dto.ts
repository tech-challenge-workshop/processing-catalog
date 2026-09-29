export interface VideoValidationRequestedDto {
  eventId: string;
  processingRequestId: string;
  ownerUserId: string;
  sourceStorageKey: string;
  occurredAt: string;
  /** Omitted, never null, when the request has none. */
  correlationId?: string;
}
