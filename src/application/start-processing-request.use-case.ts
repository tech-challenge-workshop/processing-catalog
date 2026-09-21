import { Inject } from '@nestjs/common';
import {
  ProcessingRequest,
  ProcessingRequestDomainError,
  startProcessingRequest,
} from '../domain/processing-request';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work';
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
    @Inject(UNIT_OF_WORK)
    private readonly unitOfWork: UnitOfWork,
  ) {}

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

    if (await this.repository.hasEventBeenProcessed(input.eventId)) {
      const existing = await this.repository.findByEventId(input.eventId);
      if (existing) {
        return existing;
      }
    }

    const request = await this.repository.findByProcessingRequestId(
      input.processingRequestId,
    );
    if (!request) {
      throw new ProcessingRequestDomainError(
        `Processing request ${input.processingRequestId} not found`,
      );
    }

    const updated = startProcessingRequest(request);

    // No outbox row: entering PROCESSING is not a terminal outcome and no
    // other service acts on it. The transaction still binds the state change
    // to its deduplication record.
    await this.unitOfWork.runInTransaction(async (ctx) => {
      await ctx.requests.update(updated);
      await ctx.requests.markEventProcessed(
        input.eventId,
        updated.processingRequestId,
      );
    });

    // Entering PROCESSING publishes nothing: it is not a terminal outcome and
    // no other service acts on it.
    return updated;
  }
}
