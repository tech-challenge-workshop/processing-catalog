import { randomUUID } from 'crypto';
import {
  ProcessingRequestStatus,
  startProcessingRequest,
} from '../domain/processing-request';
import { failureReasonFor } from '../domain/failure-reason';
import { InMemoryProcessingRequestRepository } from '../infrastructure/in-memory-processing-request.repository';
import { InMemoryEventPublisher } from '../infrastructure/in-memory-event-publisher';
import { AcceptProcessingRequestUseCase } from './accept-processing-request.use-case';
import { CreateProcessingRequestUseCase } from './create-processing-request.use-case';
import { FailProcessingRequestUseCase } from './fail-processing-request.use-case';

describe('FailProcessingRequestUseCase', () => {
  let repository: InMemoryProcessingRequestRepository;
  let publisher: InMemoryEventPublisher;
  let useCase: FailProcessingRequestUseCase;

  beforeEach(() => {
    repository = new InMemoryProcessingRequestRepository();
    publisher = new InMemoryEventPublisher();
    useCase = new FailProcessingRequestUseCase(repository, publisher);
  });

  const received = () =>
    new CreateProcessingRequestUseCase(repository, publisher).execute({
      eventId: randomUUID(),
      ownerUserId: 'user-123',
      sourceStorageKey: 'videos/input.mp4',
    });

  const queued = async () => {
    const created = await received();
    return new AcceptProcessingRequestUseCase(repository, publisher).execute({
      eventId: randomUUID(),
      processingRequestId: created.processingRequestId,
      occurredAt: new Date().toISOString(),
    });
  };

  it('fails a RECEIVED request and publishes one terminal event', async () => {
    const request = await received();
    const before = publisher.publishedTerminalEvents.length;

    const updated = await useCase.execute({
      eventId: 'rejected-1',
      processingRequestId: request.processingRequestId,
      failureCode: 'FORMATO_INVALIDO',
      occurredAt: '2026-09-20T00:00:00Z',
    });

    expect(updated.status).toBe(ProcessingRequestStatus.FAILED);
    expect(updated.failureCode).toBe('FORMATO_INVALIDO');
    expect(publisher.publishedTerminalEvents).toHaveLength(before + 1);
  });

  it('publishes a failure reason and no zipStorageKey', async () => {
    const request = await received();

    await useCase.execute({
      eventId: 'rejected-1',
      processingRequestId: request.processingRequestId,
      failureCode: 'DURACAO_EXCEDIDA',
      occurredAt: '2026-09-20T00:00:00Z',
    });

    const event = publisher.publishedTerminalEvents.at(-1)!;
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
      processingRequestId: request.processingRequestId,
      failureCode: 'FORMATO_INVALIDO',
      occurredAt: new Date().toISOString(),
    });

    expect(publisher.publishedTerminalEvents.at(-1)!.attemptId).toBeUndefined();
  });

  it('carries the attemptId when the attempt had started', async () => {
    const request = await queued();
    repository.update(startProcessingRequest(request));

    await useCase.execute({
      eventId: 'failed-1',
      processingRequestId: request.processingRequestId,
      failureCode: 'PROCESSAMENTO_FALHOU',
      occurredAt: new Date().toISOString(),
    });

    expect(publisher.publishedTerminalEvents.at(-1)!.attemptId).toBe(
      request.attemptId,
    );
  });

  it('fails a PROCESSING request', async () => {
    const request = await queued();
    repository.update(startProcessingRequest(request));

    const updated = await useCase.execute({
      eventId: 'failed-1',
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
      processingRequestId: request.processingRequestId,
      failureCode: 'FORMATO_INVALIDO' as const,
      occurredAt: new Date().toISOString(),
    };
    const before = publisher.publishedTerminalEvents.length;

    await useCase.execute(input);
    await useCase.execute(input);

    expect(publisher.publishedTerminalEvents).toHaveLength(before + 1);
  });

  it('rejects a code outside the vocabulary before touching the domain', async () => {
    const request = await received();

    await expect(
      useCase.execute({
        eventId: 'rejected-1',
        processingRequestId: request.processingRequestId,
        failureCode: 'INVENTADO' as never,
        occurredAt: new Date().toISOString(),
      }),
    ).rejects.toThrow('Unknown failure code INVENTADO');

    expect(
      repository.findByProcessingRequestId(request.processingRequestId)?.status,
    ).toBe(ProcessingRequestStatus.RECEIVED);
  });

  it('rejects a request that is already terminal and leaves its state unchanged', async () => {
    const request = await received();
    await useCase.execute({
      eventId: 'rejected-1',
      processingRequestId: request.processingRequestId,
      failureCode: 'FORMATO_INVALIDO',
      occurredAt: new Date().toISOString(),
    });

    await expect(
      useCase.execute({
        eventId: 'rejected-2',
        processingRequestId: request.processingRequestId,
        failureCode: 'PROCESSAMENTO_FALHOU',
        occurredAt: new Date().toISOString(),
      }),
    ).rejects.toThrow('Cannot fail request in FAILED status');

    expect(
      repository.findByProcessingRequestId(request.processingRequestId)
        ?.failureCode,
    ).toBe('FORMATO_INVALIDO');
  });

  it('does not mark the event processed when publication fails', async () => {
    const request = await received();
    jest
      .spyOn(publisher, 'publishTerminalEvent')
      .mockRejectedValueOnce(new Error('broker down'));

    await expect(
      useCase.execute({
        eventId: 'rejected-1',
        processingRequestId: request.processingRequestId,
        failureCode: 'FORMATO_INVALIDO',
        occurredAt: new Date().toISOString(),
      }),
    ).rejects.toThrow('broker down');

    expect(repository.hasEventBeenProcessed('rejected-1')).toBe(false);
  });
});
