import { ProcessingRequest } from './processing-request';

export interface ProcessingRequestRepository {
  save(request: ProcessingRequest): void;
  update(request: ProcessingRequest): void;
  findByProcessingRequestId(
    processingRequestId: string,
  ): ProcessingRequest | undefined;
  findByEventId(eventId: string): ProcessingRequest | undefined;
  markEventProcessed(eventId: string, processingRequestId?: string): void;
  hasEventBeenProcessed(eventId: string): boolean;
}
