import { Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  ProcessingRequest,
  ProcessingRequestDomainError,
  acceptProcessingRequest,
} from '../domain/processing-request';
import type { ProcessingRequestRepository } from '../domain/processing-request.repository';
import type { EventPublisher } from './event-publisher';

export interface AcceptProcessingRequestInput {
  eventId: string;
  processingRequestId: string;
  occurredAt: string;
}

export class AcceptProcessingRequestUseCase {
  constructor(
    @Inject('ProcessingRequestRepository')
    private readonly repository: ProcessingRequestRepository,
    @Inject('EventPublisher')
    private readonly publisher: EventPublisher,
  ) {}

  execute(input: AcceptProcessingRequestInput): ProcessingRequest {
    if (!input.eventId || input.eventId.trim().length === 0) {
      throw new ProcessingRequestDomainError('eventId is required');
    }
    if (
      !input.processingRequestId ||
      input.processingRequestId.trim().length === 0
    ) {
      throw new ProcessingRequestDomainError('processingRequestId is required');
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

    const updated = acceptProcessingRequest(request);

    this.repository.update(updated);

    this.publisher.publishProcessingQueued({
      eventId: randomUUID(),
      processingRequestId: updated.processingRequestId,
      ownerUserId: updated.ownerUserId,
      sourceStorageKey: updated.sourceStorageKey,
      attemptId: updated.attemptId as string,
      occurredAt: input.occurredAt,
    });

    this.repository.markEventProcessed(
      input.eventId,
      updated.processingRequestId,
    );

    return updated;
  }
}
