import { FailureCode } from '../../domain/processing-request';

export interface VideoRejectedDto {
  eventId: string;
  processingRequestId: string;
  failureCode: FailureCode;
  occurredAt: string;
}
