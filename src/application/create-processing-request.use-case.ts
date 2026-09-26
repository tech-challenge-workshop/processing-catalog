import { Inject } from '@nestjs/common';
import {
  ProcessingRequest,
  ProcessingRequestDomainError,
  createProcessingRequest,
} from '../domain/processing-request';
import {
  DuplicateIdempotencyKeyError,
  DuplicateSourceError,
  type ProcessingRequestRepository,
} from '../domain/processing-request.repository';
import { EVENT_ROUTES } from './event-routes';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work';
import { VideoValidationRequestedEvent } from './event-publisher';

export interface CreateProcessingRequestInput {
  eventId: string;
  ownerUserId: string;
  sourceStorageKey: string;
  idempotencyKey: string;
}

/** `created` wrote a request; `replayed` returned one and wrote nothing. */
export type CreateProcessingRequestOutcome = 'created' | 'replayed';

export interface CreateProcessingRequestResult {
  request: ProcessingRequest;
  outcome: CreateProcessingRequestOutcome;
}

/** The owner's key is already bound to a different upload. */
export class IdempotencyConflictError extends Error {
  constructor() {
    super('idempotencyKey is already used for a different sourceStorageKey');
  }
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
  ): Promise<CreateProcessingRequestResult> {
    if (!input.eventId || input.eventId.trim().length === 0) {
      throw new ProcessingRequestDomainError('eventId is required');
    }
    if (!input.idempotencyKey || input.idempotencyKey.trim().length === 0) {
      throw new ProcessingRequestDomainError('idempotencyKey is required');
    }

    const existing = await this.repository.findByEventId(input.eventId);
    if (existing) {
      return { request: existing, outcome: 'replayed' };
    }

    // Validates the owner and the source before anything is looked up.
    const request = createProcessingRequest({
      ownerUserId: input.ownerUserId,
      sourceStorageKey: input.sourceStorageKey,
      idempotencyKey: input.idempotencyKey,
    });

    const bound = await this.repository.findByOwnerAndIdempotencyKey(
      input.ownerUserId,
      input.idempotencyKey,
    );
    if (bound) {
      return this.replay(bound, input);
    }

    // The key is new. One upload is one request, so a source the owner
    // already has answers with that request, whatever key created it.
    const known = await this.repository.findByOwnerAndSource(
      input.ownerUserId,
      input.sourceStorageKey,
    );
    if (known) {
      return { request: known, outcome: 'replayed' };
    }

    const event: VideoValidationRequestedEvent = {
      eventId: input.eventId,
      processingRequestId: request.processingRequestId,
      ownerUserId: request.ownerUserId,
      sourceStorageKey: request.sourceStorageKey,
      occurredAt: request.createdAt.toISOString(),
    };

    try {
      // The state, the event and the deduplication record commit together.
      // The relay is the only thing that talks to the broker.
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
    } catch (error) {
      if (error instanceof DuplicateSourceError) {
        // A concurrent create for the same source, under another key,
        // committed first. As below, ours was rolled back and the winner is
        // read outside it.
        const winner = await this.repository.findByOwnerAndSource(
          input.ownerUserId,
          input.sourceStorageKey,
        );
        if (!winner) {
          throw error;
        }
        return { request: winner, outcome: 'replayed' };
      }
      if (!(error instanceof DuplicateIdempotencyKeyError)) {
        throw error;
      }
      // A concurrent create with the same key committed first. Our
      // transaction was rolled back, so nothing of ours was written; the
      // winner is read here, outside it, on a fresh query.
      const winner = await this.repository.findByOwnerAndIdempotencyKey(
        input.ownerUserId,
        input.idempotencyKey,
      );
      if (!winner) {
        throw error;
      }
      return this.replay(winner, input);
    }

    return { request, outcome: 'created' };
  }

  private replay(
    bound: ProcessingRequest,
    input: CreateProcessingRequestInput,
  ): CreateProcessingRequestResult {
    if (bound.sourceStorageKey !== input.sourceStorageKey) {
      throw new IdempotencyConflictError();
    }
    return { request: bound, outcome: 'replayed' };
  }
}
