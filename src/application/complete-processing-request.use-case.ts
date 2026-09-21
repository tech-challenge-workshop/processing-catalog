import { Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  ProcessingRequest,
  ProcessingRequestDomainError,
  completeProcessingRequest,
} from '../domain/processing-request';
import { EVENT_ROUTES } from './event-routes';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work';
import type { ProcessingRequestRepository } from '../domain/processing-request.repository';

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
    @Inject(UNIT_OF_WORK)
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(
    input: CompleteProcessingRequestInput,
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
    if (!input.zipStorageKey || input.zipStorageKey.trim().length === 0) {
      throw new ProcessingRequestDomainError('zipStorageKey is required');
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

    const updated = completeProcessingRequest(request, input.zipStorageKey);

    await this.unitOfWork.runInTransaction(async (ctx) => {
      await ctx.requests.update(updated);
      await ctx.outbox.add(
        EVENT_ROUTES.TerminalEvent.queue,
        EVENT_ROUTES.TerminalEvent.pattern,
        {
          eventId: randomUUID(),
          processingRequestId: updated.processingRequestId,
          ownerUserId: updated.ownerUserId,
          status: updated.status,
          zipStorageKey: updated.zipStorageKey,
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
