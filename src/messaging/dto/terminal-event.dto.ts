import { ProcessingRequestStatus } from '../../domain/processing-request';

export interface TerminalEventDto {
  eventId: string;
  processingRequestId: string;
  ownerUserId: string;
  status: ProcessingRequestStatus;
  /** Present when the request completed. Mutually exclusive with failureReason. */
  zipStorageKey?: string;
  /** Present when the request failed. Already safe for a user to read. */
  failureReason?: string;
  /** Absent when the request failed before any attempt started. */
  attemptId?: string;
  occurredAt: string;
}
