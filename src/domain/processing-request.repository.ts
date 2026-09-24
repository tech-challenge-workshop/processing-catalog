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
  /**
   * Reads a request and holds it until the enclosing transaction ends.
   *
   * Two events for the same request - a start and a completion racing on
   * different queues - would otherwise both read the old status and the last
   * write would win. Only meaningful inside a unit of work.
   */
  findForUpdate(
    processingRequestId: string,
  ): Promise<ProcessingRequest | undefined>;
  findByEventId(eventId: string): Promise<ProcessingRequest | undefined>;
  markEventProcessed(
    eventId: string,
    processingRequestId?: string,
  ): Promise<void>;
  hasEventBeenProcessed(eventId: string): Promise<boolean>;
}
