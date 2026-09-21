import { Inject } from '@nestjs/common';
import {
  ProcessingRequest,
  ProcessingRequestDomainError,
  startProcessingRequest,
} from '../domain/processing-request';
import type { ProcessingRequestRepository } from '../domain/processing-request.repository';

export interface StartProcessingRequestInput {
  eventId: string;
  processingRequestId: string;
  occurredAt: string;
}

export class StartProcessingRequestUseCase {
  constructor(
    @Inject('ProcessingRequestRepository')
    private readonly repository: ProcessingRequestRepository,
  ) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async execute(
    input: StartProcessingRequestInput,
  ): Promise<ProcessingRequest> {
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

    const updated = startProcessingRequest(request);

    this.repository.update(updated);
    this.repository.markEventProcessed(
      input.eventId,
      updated.processingRequestId,
    );

    // Entering PROCESSING publishes nothing: it is not a terminal outcome and
    // no other service acts on it.
    return updated;
  }
}
