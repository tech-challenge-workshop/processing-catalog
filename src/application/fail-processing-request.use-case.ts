import { Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  FailureCode,
  ProcessingRequest,
  ProcessingRequestDomainError,
  failProcessingRequest,
  isFailureCode,
} from '../domain/processing-request';
import { failureReasonFor } from '../domain/failure-reason';
import { EVENT_ROUTES } from './event-routes';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work';
import type { ProcessingRequestRepository } from '../domain/processing-request.repository';

export interface FailProcessingRequestInput {
  eventId: string;
  processingRequestId: string;
  failureCode: FailureCode;
  occurredAt: string;
}

/**
 * Moves a request to FAILED and publishes one terminal event carrying the
 * mapped reason.
 *
 * Serves both failing paths - a video refused by validation and an attempt
 * that could not be completed - because they are the same transition reported
 * by two different events. Which source states are permitted is the domain's
 * decision, not this use case's, so two classes would differ in name only.
 */
export class FailProcessingRequestUseCase {
  constructor(
    @Inject('ProcessingRequestRepository')
    private readonly repository: ProcessingRequestRepository,
    @Inject(UNIT_OF_WORK)
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(input: FailProcessingRequestInput): Promise<ProcessingRequest> {
    if (!input.eventId || input.eventId.trim().length === 0) {
      throw new ProcessingRequestDomainError('eventId is required');
    }
    if (
      !input.processingRequestId ||
      input.processingRequestId.trim().length === 0
    ) {
      throw new ProcessingRequestDomainError('processingRequestId is required');
    }
    if (!isFailureCode(input.failureCode)) {
      // Rejected before the domain is touched, so an unknown code is never
      // stored and never published.
      throw new ProcessingRequestDomainError(
        `Unknown failure code ${String(input.failureCode)}`,
      );
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

    const updated = failProcessingRequest(request, input.failureCode);

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
          failureReason: failureReasonFor(input.failureCode),
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
