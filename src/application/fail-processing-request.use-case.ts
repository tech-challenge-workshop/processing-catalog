import { Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  FailureCode,
  ProcessingRequest,
  ProcessingRequestDomainError,
  failProcessingRequest,
  isFailureCode,
  isStaleAttempt,
  rejectProcessingRequest,
} from '../domain/processing-request';
import { failureReasonFor } from '../domain/failure-reason';
import { EVENT_ROUTES } from './event-routes';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work';
import type { ProcessingRequestRepository } from '../domain/processing-request.repository';

/**
 * Which event reported the failure: `validation` is VideoRejected, a refusal
 * before any attempt; `processing` is ProcessingFailed, the end of an attempt.
 */
export type FailureOrigin = 'validation' | 'processing';

export interface FailProcessingRequestInput {
  eventId: string;
  origin: FailureOrigin;
  /** The attempt a processing failure belongs to. */
  attemptId?: string;
  processingRequestId: string;
  failureCode: FailureCode;
  occurredAt: string;
}

/**
 * Moves a request to FAILED and publishes one terminal event carrying the
 * mapped reason.
 *
 * Serves both failing paths - a video refused by validation and an attempt
 * that could not be completed - because they end in the same state and the
 * same terminal event. The origin picks the domain transition, and the domain
 * decides which source states each one permits.
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

      if (
        input.origin === 'processing' &&
        isStaleAttempt(request, input.attemptId)
      ) {
        // An event from an earlier attempt: recorded so its redelivery is a
        // duplicate, and otherwise ignored. Checked before the transition, so
        // it is never mistaken for a restatement of the current attempt.
        await ctx.requests.markEventProcessed(
          input.eventId,
          request.processingRequestId,
        );
        return request;
      }

      const updated =
        input.origin === 'validation'
          ? rejectProcessingRequest(request, input.failureCode)
          : failProcessingRequest(request, input.failureCode);

      await ctx.requests.update(updated);
      await ctx.outbox.add(
        EVENT_ROUTES.TerminalEvent.queue,
        EVENT_ROUTES.TerminalEvent.pattern,
        {
          eventId: randomUUID(),
          processingRequestId: updated.processingRequestId,
          ownerUserId: updated.ownerUserId,
          ownerEmail: updated.ownerEmail,
          status: updated.status,
          failureReason: failureReasonFor(input.failureCode),
          attemptId: updated.attemptId,
          occurredAt: input.occurredAt,
          // From the stored request, never the consumer's log context.
          ...(updated.correlationId !== undefined
            ? { correlationId: updated.correlationId }
            : {}),
        },
      );
      await ctx.requests.markEventProcessed(
        input.eventId,
        updated.processingRequestId,
      );
      return updated;
    });
  }
}
