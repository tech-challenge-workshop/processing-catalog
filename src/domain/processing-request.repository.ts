import { ProcessingRequest } from './processing-request';

/**
 * Asynchronous because the real implementation is PostgreSQL. A synchronous
 * signature over a database would be a lie about what the call does, and the
 * in-memory adapter honours the same shape so the two stay interchangeable.
 */
export interface ProcessingRequestRepository {
  save(request: ProcessingRequest): Promise<void>;
  update(request: ProcessingRequest): Promise<void>;
  findByProcessingRequestId(
    processingRequestId: string,
  ): Promise<ProcessingRequest | undefined>;
  findByEventId(eventId: string): Promise<ProcessingRequest | undefined>;
  markEventProcessed(
    eventId: string,
    processingRequestId?: string,
  ): Promise<void>;
  hasEventBeenProcessed(eventId: string): Promise<boolean>;
}
