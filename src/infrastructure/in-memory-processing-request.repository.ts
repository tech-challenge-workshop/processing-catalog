import { ProcessingRequest } from '../domain/processing-request';
import { ProcessingRequestRepository } from '../domain/processing-request.repository';

export class InMemoryProcessingRequestRepository implements ProcessingRequestRepository {
  private requests = new Map<string, ProcessingRequest>();
  private eventIdToRequestId = new Map<string, string>();

  save(request: ProcessingRequest): void {
    this.requests.set(request.processingRequestId, request);
  }

  findByProcessingRequestId(
    processingRequestId: string,
  ): ProcessingRequest | undefined {
    return this.requests.get(processingRequestId);
  }

  findByEventId(eventId: string): ProcessingRequest | undefined {
    const processingRequestId = this.eventIdToRequestId.get(eventId);
    if (!processingRequestId) {
      return undefined;
    }
    return this.requests.get(processingRequestId);
  }

  markEventProcessed(eventId: string, processingRequestId?: string): void {
    if (processingRequestId) {
      this.eventIdToRequestId.set(eventId, processingRequestId);
    } else {
      this.eventIdToRequestId.set(eventId, '');
    }
  }

  hasEventBeenProcessed(eventId: string): boolean {
    return this.eventIdToRequestId.has(eventId);
  }
}
