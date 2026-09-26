import { ProcessingRequest } from '../domain/processing-request';
import { ProcessingRequestRepository } from '../domain/processing-request.repository';

/**
 * The unit-test adapter. It satisfies the asynchronous port without a
 * database, so the fast suite stays fast; the PostgreSQL adapter is proven
 * against PostgreSQL.
 */
export class InMemoryProcessingRequestRepository implements ProcessingRequestRepository {
  private requests = new Map<string, ProcessingRequest>();
  private eventIdToRequestId = new Map<string, string>();

  save(request: ProcessingRequest): Promise<void> {
    this.requests.set(request.processingRequestId, request);
    return Promise.resolve();
  }

  update(request: ProcessingRequest): Promise<void> {
    this.requests.set(request.processingRequestId, request);
    return Promise.resolve();
  }

  findByProcessingRequestId(
    processingRequestId: string,
  ): Promise<ProcessingRequest | undefined> {
    return Promise.resolve(this.requests.get(processingRequestId));
  }

  /**
   * No lock: a single-threaded map has no concurrent writer to wait for. The
   * locking behaviour is proven against PostgreSQL in the integration suite.
   */
  findForUpdate(
    processingRequestId: string,
  ): Promise<ProcessingRequest | undefined> {
    return this.findByProcessingRequestId(processingRequestId);
  }

  findByEventId(eventId: string): Promise<ProcessingRequest | undefined> {
    const processingRequestId = this.eventIdToRequestId.get(eventId);
    if (!processingRequestId) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(this.requests.get(processingRequestId));
  }

  markEventProcessed(
    eventId: string,
    processingRequestId?: string,
  ): Promise<void> {
    this.eventIdToRequestId.set(eventId, processingRequestId ?? '');
    return Promise.resolve();
  }

  hasEventBeenProcessed(eventId: string): Promise<boolean> {
    return Promise.resolve(this.eventIdToRequestId.has(eventId));
  }

  findPageByOwner(
    ownerUserId: string,
    offset: number,
    limit: number,
  ): Promise<ProcessingRequest[]> {
    const page = this.ownedBy(ownerUserId)
      .sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() ||
          compare(a.processingRequestId, b.processingRequestId),
      )
      .slice(offset, offset + limit);
    return Promise.resolve(page);
  }

  countByOwner(ownerUserId: string): Promise<number> {
    return Promise.resolve(this.ownedBy(ownerUserId).length);
  }

  findByIdAndOwner(
    processingRequestId: string,
    ownerUserId: string,
  ): Promise<ProcessingRequest | undefined> {
    const request = this.requests.get(processingRequestId);
    return Promise.resolve(
      request?.ownerUserId === ownerUserId ? request : undefined,
    );
  }

  private ownedBy(ownerUserId: string): ProcessingRequest[] {
    return [...this.requests.values()].filter(
      (r) => r.ownerUserId === ownerUserId,
    );
  }
}

/**
 * Plain code-unit order. For lowercase canonical UUIDs it matches the
 * byte order PostgreSQL uses for the `uuid` type, so both adapters page alike.
 */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
