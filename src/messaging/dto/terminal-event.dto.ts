import { ProcessingRequestStatus } from '../../domain/processing-request';

export interface TerminalEventDto {
  eventId: string;
  processingRequestId: string;
  ownerUserId: string;
  status: ProcessingRequestStatus;
  zipStorageKey: string;
  occurredAt: string;
}
