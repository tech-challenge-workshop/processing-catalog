import { Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  ProcessingRequest,
  ProcessingRequestDomainError,
  acceptProcessingRequest,
} from '../domain/processing-request';
import { EVENT_ROUTES } from './event-routes';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work';
import type { ProcessingRequestRepository } from '../domain/processing-request.repository';

export interface AcceptProcessingRequestInput {
  eventId: string;
  processingRequestId: string;
  occurredAt: string;
}

export class AcceptProcessingRequestUseCase {
  constructor(
    @Inject('ProcessingRequestRepository')
    private readonly repository: ProcessingRequestRepository,
    @Inject(UNIT_OF_WORK)
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(
    input: AcceptProcessingRequestInput,
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

    const updated = acceptProcessingRequest(request);

    await this.unitOfWork.runInTransaction(async (ctx) => {
      await ctx.requests.update(updated);
      await ctx.outbox.add(
        EVENT_ROUTES.ProcessingQueued.queue,
        EVENT_ROUTES.ProcessingQueued.pattern,
        {
          eventId: randomUUID(),
          processingRequestId: updated.processingRequestId,
          ownerUserId: updated.ownerUserId,
          sourceStorageKey: updated.sourceStorageKey,
          attemptId: updated.attemptId,
          occurredAt: input.occurredAt,
        },
      );
      await ctx.requests.markEventProcessed(
        input.eventId,
        updated.processingRequestId,
      );
    });

    return updated;
  }
}
