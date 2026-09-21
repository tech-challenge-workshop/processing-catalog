import { Inject } from '@nestjs/common';
import {
  ProcessingRequest,
  ProcessingRequestDomainError,
  createProcessingRequest,
} from '../domain/processing-request';
import type { ProcessingRequestRepository } from '../domain/processing-request.repository';
import { EVENT_ROUTES } from './event-routes';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work';
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
    @Inject(UNIT_OF_WORK)
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(
    input: CreateProcessingRequestInput,
  ): Promise<ProcessingRequest> {
    if (!input.eventId || input.eventId.trim().length === 0) {
      throw new ProcessingRequestDomainError('eventId is required');
    }

    const existing = await this.repository.findByEventId(input.eventId);
    if (existing) {
      return existing;
    }

    const request = createProcessingRequest({
      ownerUserId: input.ownerUserId,
      sourceStorageKey: input.sourceStorageKey,
    });

    const event: VideoValidationRequestedEvent = {
      eventId: input.eventId,
      processingRequestId: request.processingRequestId,
      ownerUserId: request.ownerUserId,
      sourceStorageKey: request.sourceStorageKey,
      occurredAt: request.createdAt.toISOString(),
    };

    // The state, the event and the deduplication record commit together. The
    // relay is the only thing that talks to the broker.
    await this.unitOfWork.runInTransaction(async (ctx) => {
      await ctx.requests.save(request);
      await ctx.outbox.add(
        EVENT_ROUTES.VideoValidationRequested.queue,
        EVENT_ROUTES.VideoValidationRequested.pattern,
        { ...event },
      );
      await ctx.requests.markEventProcessed(
        input.eventId,
        request.processingRequestId,
      );
    });

    return request;
  }
}
