import { FailureCode } from '../../domain/processing-request';

export interface ProcessingFailedDto {
  eventId: string;
  processingRequestId: string;
  attemptId: string;
  failureCode: FailureCode;
  occurredAt: string;
  /**
   * The pipeline's trace id. Optional: absent or invalid, the consumer
   * generates one for its log context and still handles the message.
   */
  correlationId?: string;
}
