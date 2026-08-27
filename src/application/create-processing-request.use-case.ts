import { Inject } from '@nestjs/common';
import {
  ProcessingRequest,
  ProcessingRequestDomainError,
  createProcessingRequest,
} from '../domain/processing-request';
import type { ProcessingRequestRepository } from '../domain/processing-request.repository';
import type { EventPublisher } from './event-publisher';
import { VideoValidationRequestedEvent } from './event-publisher';

export interface CreateProcessingRequestInput {
  eventId: string;
  ownerUserId: string;
  sourceStorageKey: string;
}

export class CreateProcessingRequestUseCase {
  constructor(
    @Inject('ProcessingRequestRepository')
    private readonly repository: ProcessingRequestRepository,
    @Inject('EventPublisher')
    private readonly publisher: EventPublisher,
  ) {}

  execute(input: CreateProcessingRequestInput): ProcessingRequest {
    if (!input.eventId || input.eventId.trim().length === 0) {
      throw new ProcessingRequestDomainError('eventId is required');
    }

    const existing = this.repository.findByEventId(input.eventId);
    if (existing) {
      return existing;
    }

    const request = createProcessingRequest({
      ownerUserId: input.ownerUserId,
      sourceStorageKey: input.sourceStorageKey,
    });

    this.repository.save(request);

    const event: VideoValidationRequestedEvent = {
      eventId: input.eventId,
      processingRequestId: request.processingRequestId,
      ownerUserId: request.ownerUserId,
      sourceStorageKey: request.sourceStorageKey,
      occurredAt: request.createdAt.toISOString(),
    };

    this.publisher.publish(event);
    this.repository.markEventProcessed(
      input.eventId,
      request.processingRequestId,
    );

    return request;
  }
}
