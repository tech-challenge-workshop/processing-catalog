import { Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  ProcessingRequest,
  ProcessingRequestDomainError,
  completeProcessingRequest,
} from '../domain/processing-request';
import type { ProcessingRequestRepository } from '../domain/processing-request.repository';
import type { EventPublisher } from './event-publisher';

export interface CompleteProcessingRequestInput {
  eventId: string;
  processingRequestId: string;
  zipStorageKey: string;
  occurredAt: string;
}

export class CompleteProcessingRequestUseCase {
  constructor(
    @Inject('ProcessingRequestRepository')
    private readonly repository: ProcessingRequestRepository,
    @Inject('EventPublisher')
    private readonly publisher: EventPublisher,
  ) {}

  execute(input: CompleteProcessingRequestInput): ProcessingRequest {
    if (!input.eventId || input.eventId.trim().length === 0) {
      throw new ProcessingRequestDomainError('eventId is required');
    }
    if (
      !input.processingRequestId ||
      input.processingRequestId.trim().length === 0
    ) {
      throw new ProcessingRequestDomainError('processingRequestId is required');
    }
    if (!input.zipStorageKey || input.zipStorageKey.trim().length === 0) {
      throw new ProcessingRequestDomainError('zipStorageKey is required');
    }

    if (this.repository.hasEventBeenProcessed(input.eventId)) {
      const existing = this.repository.findByEventId(input.eventId);
      if (existing) {
        return existing;
      }
    }

    const request = this.repository.findByProcessingRequestId(
      input.processingRequestId,
    );
    if (!request) {
      throw new ProcessingRequestDomainError(
        `Processing request ${input.processingRequestId} not found`,
      );
    }

    const updated = completeProcessingRequest(request, input.zipStorageKey);

    this.repository.update(updated);

    this.publisher.publishTerminalEvent({
      eventId: randomUUID(),
      processingRequestId: updated.processingRequestId,
      ownerUserId: updated.ownerUserId,
      status: updated.status,
      zipStorageKey: updated.zipStorageKey as string,
      occurredAt: input.occurredAt,
    });

    this.repository.markEventProcessed(
      input.eventId,
      updated.processingRequestId,
    );

    return updated;
  }
}
