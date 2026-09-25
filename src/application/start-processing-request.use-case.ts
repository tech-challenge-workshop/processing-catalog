import { Inject } from '@nestjs/common';
import {
  ProcessingRequest,
  ProcessingRequestDomainError,
  isUnchanged,
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

    // No outbox row: entering PROCESSING is not a terminal outcome and no
    // other service acts on it. The transaction still binds the state change
    // to its deduplication record.
    return this.unitOfWork.runInTransaction(async (ctx) => {
      const request = await ctx.requests.findForUpdate(
        input.processingRequestId,
      );
      if (!request) {
        throw new ProcessingRequestDomainError(
          `Processing request ${input.processingRequestId} not found`,
        );
      }
      // Checked again under the lock: the check above can race a concurrent
      // delivery of the same event.
      if (await ctx.requests.hasEventBeenProcessed(input.eventId)) {
        return request;
      }

      const updated = startProcessingRequest(request);

      if (!isUnchanged(request, updated)) {
        await ctx.requests.update(updated);
      }
      await ctx.requests.markEventProcessed(
        input.eventId,
        updated.processingRequestId,
      );
      return updated;
    });
  }
}
