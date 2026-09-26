import { ProcessingRequest } from './processing-request';

/**
 * Raised by `save` when the owner already has a request under the same
 * idempotency key. Both adapters raise it - PostgreSQL through its unique
 * index - so the caller handles a lost race the same way everywhere.
 */
export class DuplicateIdempotencyKeyError extends Error {
  constructor(ownerUserId: string, idempotencyKey: string) {
    super(
      `Owner ${ownerUserId} already has a request under idempotency key ${idempotencyKey}`,
    );
  }
}

/**
 * Raised by `save` when the owner already has a request for the same source,
 * whatever its key. One upload is one request; PostgreSQL enforces it with
 * `uq_processing_request_owner_source`, the in-memory adapter by hand.
 */
export class DuplicateSourceError extends Error {
  constructor(ownerUserId: string, sourceStorageKey: string) {
    super(
      `Owner ${ownerUserId} already has a request for source ${sourceStorageKey}`,
    );
  }
}

/**
 * Asynchronous because the real implementation is PostgreSQL. A synchronous
 * signature over a database would be a lie about what the call does, and the
 * in-memory adapter honours the same shape so the two stay interchangeable.
 */
export interface ProcessingRequestRepository {
  /**
   * @throws DuplicateIdempotencyKeyError on a taken (owner, key) pair.
   * @throws DuplicateSourceError on a taken (owner, source) pair.
   */
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
  /**
   * The owner-scoped reads. Each takes the owner and filters on it in the
   * query itself: there is deliberately no method that lists without one, so
   * an unscoped read cannot be written by accident.
   *
   * Ordered by `createdAt` descending, then `processingRequestId` ascending,
   * so the order is total and offset pages never repeat or skip a row.
   */
  findPageByOwner(
    ownerUserId: string,
    offset: number,
    limit: number,
  ): Promise<ProcessingRequest[]>;
  countByOwner(ownerUserId: string): Promise<number>;
  findByIdAndOwner(
    processingRequestId: string,
    ownerUserId: string,
  ): Promise<ProcessingRequest | undefined>;
  findByOwnerAndIdempotencyKey(
    ownerUserId: string,
    idempotencyKey: string,
  ): Promise<ProcessingRequest | undefined>;
  findByOwnerAndSource(
    ownerUserId: string,
    sourceStorageKey: string,
  ): Promise<ProcessingRequest | undefined>;
}
