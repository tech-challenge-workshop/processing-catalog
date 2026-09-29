import {
  InMemoryOutboxWriter,
  InMemoryUnitOfWork,
} from '../infrastructure/in-memory-unit-of-work';
import { randomUUID } from 'crypto';
import {
  ProcessingRequestDomainError,
  ProcessingRequestStatus,
  completeProcessingRequest,
  startProcessingRequest,
} from '../domain/processing-request';
import { failureReasonFor } from '../domain/failure-reason';
import { InMemoryProcessingRequestRepository } from '../infrastructure/in-memory-processing-request.repository';
import { correlationContext } from '../observability/correlation-context';
import { AcceptProcessingRequestUseCase } from './accept-processing-request.use-case';
import { CreateProcessingRequestUseCase } from './create-processing-request.use-case';
import { FailProcessingRequestUseCase } from './fail-processing-request.use-case';

describe('FailProcessingRequestUseCase', () => {
  let repository: InMemoryProcessingRequestRepository;
  let outbox: InMemoryOutboxWriter;
  let unitOfWork: InMemoryUnitOfWork;
  let useCase: FailProcessingRequestUseCase;

  beforeEach(() => {
    repository = new InMemoryProcessingRequestRepository();
    outbox = new InMemoryOutboxWriter();
    unitOfWork = new InMemoryUnitOfWork(repository, outbox);
    useCase = new FailProcessingRequestUseCase(repository, unitOfWork);
  });

  const received = async (correlationId?: string) =>
    (
      await new CreateProcessingRequestUseCase(repository, unitOfWork).execute({
        eventId: randomUUID(),
        ownerUserId: 'user-123',
        ownerEmail: 'user-123@fiapx.local',
        sourceStorageKey: 'videos/input.mp4',
        idempotencyKey: randomUUID(),
        ...(correlationId !== undefined ? { correlationId } : {}),
      })
    ).request;

  const queued = async (correlationId?: string) => {
    const created = await received(correlationId);
    return new AcceptProcessingRequestUseCase(repository, unitOfWork).execute({
      eventId: randomUUID(),
      processingRequestId: created.processingRequestId,
      occurredAt: new Date().toISOString(),
    });
  };

  it('fails a RECEIVED request and publishes one terminal event', async () => {
    const request = await received();
    const before = outbox.recordedTerminalEvents.length;

    const updated = await useCase.execute({
      eventId: 'rejected-1',
      origin: 'validation',
      processingRequestId: request.processingRequestId,
      failureCode: 'FORMATO_INVALIDO',
      occurredAt: '2026-09-20T00:00:00Z',
    });

    expect(updated.status).toBe(ProcessingRequestStatus.FAILED);
    expect(updated.failureCode).toBe('FORMATO_INVALIDO');
    expect(outbox.recordedTerminalEvents).toHaveLength(before + 1);

    const published = outbox.recordedTerminalEvents.at(-1);
    expect(published?.ownerEmail).toBe('user-123@fiapx.local');
  });

  it('publishes a failure reason and no zipStorageKey', async () => {
    const request = await received();

    await useCase.execute({
      eventId: 'rejected-1',
      origin: 'validation',
      processingRequestId: request.processingRequestId,
      failureCode: 'DURACAO_EXCEDIDA',
      occurredAt: '2026-09-20T00:00:00Z',
    });

    const event = outbox.recordedTerminalEvents.at(-1)!;
    expect(event.status).toBe(ProcessingRequestStatus.FAILED);
    expect(event.failureReason).toBe(failureReasonFor('DURACAO_EXCEDIDA'));
    expect(event.zipStorageKey).toBeUndefined();
    expect(event.ownerUserId).toBe('user-123');
    expect(event.occurredAt).toBe('2026-09-20T00:00:00Z');
  });

  it('carries no attemptId when the request failed before any attempt started', async () => {
    const request = await received();

    await useCase.execute({
      eventId: 'rejected-1',
      origin: 'validation',
      processingRequestId: request.processingRequestId,
      failureCode: 'FORMATO_INVALIDO',
      occurredAt: new Date().toISOString(),
    });

    expect(outbox.recordedTerminalEvents.at(-1)!.attemptId).toBeUndefined();
  });

  it('carries the attemptId when the attempt had started', async () => {
    const request = await queued();
    await repository.update(startProcessingRequest(request));

    await useCase.execute({
      eventId: 'failed-1',
      origin: 'processing',
      attemptId: request.attemptId,
      processingRequestId: request.processingRequestId,
      failureCode: 'PROCESSAMENTO_FALHOU',
      occurredAt: new Date().toISOString(),
    });

    expect(outbox.recordedTerminalEvents.at(-1)!.attemptId).toBe(
      request.attemptId,
    );
  });

  it('fails a PROCESSING request', async () => {
    const request = await queued();
    await repository.update(startProcessingRequest(request));

    const updated = await useCase.execute({
      eventId: 'failed-1',
      origin: 'processing',
      attemptId: request.attemptId,
      processingRequestId: request.processingRequestId,
      failureCode: 'PROCESSAMENTO_FALHOU',
      occurredAt: new Date().toISOString(),
    });

    expect(updated.status).toBe(ProcessingRequestStatus.FAILED);
  });

  it('publishes no second event for a repeated eventId', async () => {
    const request = await received();
    const input = {
      eventId: 'rejected-1',
      origin: 'validation' as const,
      processingRequestId: request.processingRequestId,
      failureCode: 'FORMATO_INVALIDO' as const,
      occurredAt: new Date().toISOString(),
    };
    const before = outbox.recordedTerminalEvents.length;

    await useCase.execute(input);
    await useCase.execute(input);

    expect(outbox.recordedTerminalEvents).toHaveLength(before + 1);
  });

  it('rejects a code outside the vocabulary before touching the domain', async () => {
    const request = await received();

    await expect(
      useCase.execute({
        eventId: 'rejected-1',
        origin: 'validation',
        processingRequestId: request.processingRequestId,
        failureCode: 'INVENTADO' as never,
        occurredAt: new Date().toISOString(),
      }),
    ).rejects.toThrow('Unknown failure code INVENTADO');

    expect(
      (await repository.findByProcessingRequestId(request.processingRequestId))
        ?.status,
    ).toBe(ProcessingRequestStatus.RECEIVED);
  });

  it('rejects a request that is already terminal and leaves its state unchanged', async () => {
    const request = await received();
    await useCase.execute({
      eventId: 'rejected-1',
      origin: 'validation',
      processingRequestId: request.processingRequestId,
      failureCode: 'FORMATO_INVALIDO',
      occurredAt: new Date().toISOString(),
    });

    await expect(
      useCase.execute({
        eventId: 'rejected-2',
        origin: 'processing',
        processingRequestId: request.processingRequestId,
        failureCode: 'PROCESSAMENTO_FALHOU',
        occurredAt: new Date().toISOString(),
      }),
    ).rejects.toThrow('Cannot fail request in FAILED status');

    expect(
      (await repository.findByProcessingRequestId(request.processingRequestId))
        ?.failureCode,
    ).toBe('FORMATO_INVALIDO');
  });

  it('does not mark the event processed when the outbox write fails', async () => {
    const request = await received();
    jest.spyOn(outbox, 'add').mockImplementationOnce(() => {
      throw new Error('outbox write failed');
    });

    await expect(
      useCase.execute({
        eventId: 'rejected-1',
        origin: 'validation',
        processingRequestId: request.processingRequestId,
        failureCode: 'FORMATO_INVALIDO',
        occurredAt: new Date().toISOString(),
      }),
    ).rejects.toThrow('outbox write failed');

    expect(await repository.hasEventBeenProcessed('rejected-1')).toBe(false);
  });

  describe('each origin takes its own transition', () => {
    const stored = async (id: string) =>
      repository.findByProcessingRequestId(id);

    it('fails a QUEUED request on a processing failure of its attempt', async () => {
      const request = await queued();

      const updated = await useCase.execute({
        eventId: 'failed-1',
        origin: 'processing',
        attemptId: request.attemptId,
        processingRequestId: request.processingRequestId,
        failureCode: 'PROCESSAMENTO_FALHOU',
        occurredAt: new Date().toISOString(),
      });

      expect(updated.status).toBe(ProcessingRequestStatus.FAILED);
      expect((await stored(request.processingRequestId))?.failureCode).toBe(
        'PROCESSAMENTO_FALHOU',
      );
      expect(outbox.recordedTerminalEvents.at(-1)!.attemptId).toBe(
        request.attemptId,
      );
    });

    it.each<[string, () => Promise<{ processingRequestId: string }>]>([
      ['QUEUED', () => queued()],
      [
        'PROCESSING',
        async () => {
          const request = await queued();
          await repository.update(startProcessingRequest(request));
          return request;
        },
      ],
    ])(
      'refuses a validation rejection for a %s request and changes nothing',
      async (status, make) => {
        const request = await make();
        const before = outbox.recordedTerminalEvents.length;

        await expect(
          useCase.execute({
            eventId: 'rejected-late',
            origin: 'validation',
            processingRequestId: request.processingRequestId,
            failureCode: 'FORMATO_INVALIDO',
            occurredAt: new Date().toISOString(),
          }),
        ).rejects.toThrow(
          new ProcessingRequestDomainError(
            `Cannot reject request in ${status} status`,
          ),
        );

        const after = await stored(request.processingRequestId);
        expect(after?.status).toBe(status);
        expect(after?.failureCode).toBeUndefined();
        expect(outbox.recordedTerminalEvents).toHaveLength(before);
        expect(await repository.hasEventBeenProcessed('rejected-late')).toBe(
          false,
        );
      },
    );

    it('refuses a processing failure for a RECEIVED request and changes nothing', async () => {
      const request = await received();
      const before = outbox.recordedTerminalEvents.length;

      await expect(
        useCase.execute({
          eventId: 'failed-early',
          origin: 'processing',
          attemptId: randomUUID(),
          processingRequestId: request.processingRequestId,
          failureCode: 'PROCESSAMENTO_FALHOU',
          occurredAt: new Date().toISOString(),
        }),
      ).rejects.toThrow(
        new ProcessingRequestDomainError(
          'Cannot fail request in RECEIVED status',
        ),
      );

      const after = await stored(request.processingRequestId);
      expect(after?.status).toBe(ProcessingRequestStatus.RECEIVED);
      expect(after?.failureCode).toBeUndefined();
      expect(outbox.recordedTerminalEvents).toHaveLength(before);
      expect(await repository.hasEventBeenProcessed('failed-early')).toBe(
        false,
      );
    });
  });

  describe('a processing failure from another attempt', () => {
    const storedCopy = async (id: string) => ({
      ...(await repository.findByProcessingRequestId(id))!,
    });

    it('changes nothing, publishes nothing and records the event, also when redelivered', async () => {
      const request = await queued();
      const snapshot = await storedCopy(request.processingRequestId);
      const entries = outbox.entries.length;
      const stale = {
        eventId: 'failed-stale',
        origin: 'processing' as const,
        attemptId: randomUUID(),
        processingRequestId: request.processingRequestId,
        failureCode: 'PROCESSAMENTO_FALHOU' as const,
        occurredAt: new Date().toISOString(),
      };

      const returned = await useCase.execute(stale);
      const redelivered = await useCase.execute(stale);

      expect(returned).toEqual(snapshot);
      expect(redelivered).toEqual(snapshot);
      expect(await storedCopy(request.processingRequestId)).toEqual(snapshot);
      expect(snapshot.status).toBe(ProcessingRequestStatus.QUEUED);
      expect(outbox.entries).toHaveLength(entries);
      expect(await repository.hasEventBeenProcessed('failed-stale')).toBe(true);
    });

    it('cannot fail a request its current attempt completed', async () => {
      const request = await queued();
      await repository.update(
        completeProcessingRequest(
          startProcessingRequest(request),
          'zips/output.zip',
        ),
      );
      const snapshot = await storedCopy(request.processingRequestId);
      const entries = outbox.entries.length;

      const returned = await useCase.execute({
        eventId: 'failed-stale',
        origin: 'processing',
        attemptId: randomUUID(),
        processingRequestId: request.processingRequestId,
        failureCode: 'PROCESSAMENTO_FALHOU',
        occurredAt: new Date().toISOString(),
      });

      expect(returned).toEqual(snapshot);
      expect(await storedCopy(request.processingRequestId)).toEqual(snapshot);
      expect(snapshot.status).toBe(ProcessingRequestStatus.COMPLETED);
      expect(outbox.entries).toHaveLength(entries);
      expect(await repository.hasEventBeenProcessed('failed-stale')).toBe(true);
    });

    it('still lets the current attempt fail the request afterwards', async () => {
      const request = await queued();
      await useCase.execute({
        eventId: 'failed-stale',
        origin: 'processing',
        attemptId: randomUUID(),
        processingRequestId: request.processingRequestId,
        failureCode: 'PROCESSAMENTO_FALHOU',
        occurredAt: new Date().toISOString(),
      });

      const updated = await useCase.execute({
        eventId: 'failed-current',
        origin: 'processing',
        attemptId: request.attemptId,
        processingRequestId: request.processingRequestId,
        failureCode: 'PROCESSAMENTO_FALHOU',
        occurredAt: new Date().toISOString(),
      });

      expect(updated.status).toBe(ProcessingRequestStatus.FAILED);
      expect(outbox.recordedTerminalEvents.at(-1)!.attemptId).toBe(
        request.attemptId,
      );
    });

    it('checks for a duplicate under the lock before the stale check, so a racing redelivery records nothing twice', async () => {
      const request = await queued();
      // The first delivery has already committed its processed-event record.
      await repository.markEventProcessed(
        'failed-stale',
        request.processingRequestId,
      );
      const snapshot = await storedCopy(request.processingRequestId);
      const entries = outbox.entries.length;
      // The redelivery raced it: the check before the lock missed the record,
      // so only the check under the lock can see it.
      jest
        .spyOn(repository, 'hasEventBeenProcessed')
        .mockResolvedValueOnce(false);
      const mark = jest.spyOn(repository, 'markEventProcessed');

      const returned = await useCase.execute({
        eventId: 'failed-stale',
        origin: 'processing',
        attemptId: randomUUID(),
        processingRequestId: request.processingRequestId,
        failureCode: 'PROCESSAMENTO_FALHOU',
        occurredAt: new Date().toISOString(),
      });

      expect(mark).not.toHaveBeenCalled();
      expect(returned).toEqual(snapshot);
      expect(await storedCopy(request.processingRequestId)).toEqual(snapshot);
      expect(outbox.entries).toHaveLength(entries);
    });
  });

  describe('correlation id (OBS-18)', () => {
    const failAttempt = (request: {
      processingRequestId: string;
      attemptId?: string;
    }) =>
      useCase.execute({
        eventId: randomUUID(),
        origin: 'processing',
        attemptId: request.attemptId,
        processingRequestId: request.processingRequestId,
        failureCode: 'PROCESSAMENTO_FALHOU',
        occurredAt: new Date().toISOString(),
      });

    it('carries the id stored at creation on the terminal event of a processing failure', async () => {
      const request = await queued('cat-1');

      await failAttempt(request);

      expect(outbox.recordedTerminalEvents).toHaveLength(1);
      expect(outbox.recordedTerminalEvents[0].correlationId).toBe('cat-1');
    });

    it('carries the id stored at creation on the terminal event of a validation rejection', async () => {
      const request = await received('cat-1');

      await useCase.execute({
        eventId: randomUUID(),
        origin: 'validation',
        processingRequestId: request.processingRequestId,
        failureCode: 'FORMATO_INVALIDO',
        occurredAt: new Date().toISOString(),
      });

      expect(outbox.recordedTerminalEvents).toHaveLength(1);
      expect(outbox.recordedTerminalEvents[0].correlationId).toBe('cat-1');
    });

    it('omits the field when the stored request has none', async () => {
      const request = await queued();

      await failAttempt(request);

      expect(outbox.recordedTerminalEvents).toHaveLength(1);
      expect(outbox.recordedTerminalEvents[0]).not.toHaveProperty(
        'correlationId',
      );
    });

    it('takes the id from the stored request, not the ambient log context', async () => {
      const request = await queued('cat-1');

      await correlationContext.runWithCorrelation('consumer-generated', () =>
        failAttempt(request),
      );

      expect(outbox.recordedTerminalEvents[0].correlationId).toBe('cat-1');
    });
  });
});
