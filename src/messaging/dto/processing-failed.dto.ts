import { FailureCode } from '../../domain/processing-request';

export interface ProcessingFailedDto {
  eventId: string;
  processingRequestId: string;
  attemptId: string;
  failureCode: FailureCode;
  occurredAt: string;
}
