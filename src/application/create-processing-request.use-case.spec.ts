import {
  InMemoryOutboxWriter,
  InMemoryUnitOfWork,
} from '../infrastructure/in-memory-unit-of-work';
import { InMemoryProcessingRequestRepository } from '../infrastructure/in-memory-processing-request.repository';
import {
  CreateProcessingRequestUseCase,
  IdempotencyConflictError,
} from './create-processing-request.use-case';
import {
  ProcessingRequestDomainError,
  ProcessingRequestStatus,
} from '../domain/processing-request';

describe('CreateProcessingRequestUseCase', () => {
  let repository: InMemoryProcessingRequestRepository;
  let outbox: InMemoryOutboxWriter;
  let unitOfWork: InMemoryUnitOfWork;
  let useCase: CreateProcessingRequestUseCase;

  beforeEach(() => {
    repository = new InMemoryProcessingRequestRepository();
    outbox = new InMemoryOutboxWriter();
    unitOfWork = new InMemoryUnitOfWork(repository, outbox);
    useCase = new CreateProcessingRequestUseCase(repository, unitOfWork);
  });

  it('creates a request in RECEIVED state and publishes VideoValidationRequested', async () => {
    const { request } = await useCase.execute({
      eventId: 'event-123',
      ownerUserId: 'user-123',
      sourceStorageKey: 'videos/input.mp4',
      idempotencyKey: 'key-123',
    });

    expect(request.status).toBe(ProcessingRequestStatus.RECEIVED);
    expect(request.ownerUserId).toBe('user-123');
    expect(request.sourceStorageKey).toBe('videos/input.mp4');

    const published = outbox.recordedValidationRequests.at(-1);
    expect(published).toBeDefined();
    expect(published!.eventId).toBe('event-123');
    expect(published!.processingRequestId).toBe(request.processingRequestId);
    expect(published!.ownerUserId).toBe('user-123');
    expect(published!.sourceStorageKey).toBe('videos/input.mp4');
    expect(published!.occurredAt).toBe(request.createdAt.toISOString());
  });

  it('is idempotent for a repeated eventId', async () => {
    const input = {
      eventId: 'event-456',
      ownerUserId: 'user-456',
      sourceStorageKey: 'videos/another.mp4',
      idempotencyKey: 'key-456',
    };

    const firstRequest = (await useCase.execute(input)).request;
    const secondRequest = (await useCase.execute(input)).request;

    expect(firstRequest.processingRequestId).toBe(
      secondRequest.processingRequestId,
    );
    expect(outbox.recordedValidationRequests).toHaveLength(1);
  });

  it('rejects missing ownerUserId without persisting or publishing', async () => {
    await expect(
      useCase.execute({
        eventId: 'event-789',
        ownerUserId: '',
        sourceStorageKey: 'videos/input.mp4',
        idempotencyKey: 'key-789',
      }),
    ).rejects.toThrow('ownerUserId is required');

    expect(outbox.recordedValidationRequests).toHaveLength(0);
    await expect(
      repository.findByEventId('event-789'),
    ).resolves.toBeUndefined();
  });

  it('rejects missing sourceStorageKey without persisting or publishing', async () => {
    await expect(
      useCase.execute({
        eventId: 'event-abc',
        ownerUserId: 'user-abc',
        sourceStorageKey: '',
        idempotencyKey: 'key-abc',
      }),
    ).rejects.toThrow('sourceStorageKey is required');

    expect(outbox.recordedValidationRequests).toHaveLength(0);
    await expect(
      repository.findByEventId('event-abc'),
    ).resolves.toBeUndefined();
  });

  describe('idempotency key', () => {
    const input = (
      overrides: Partial<{
        eventId: string;
        ownerUserId: string;
        sourceStorageKey: string;
        idempotencyKey: string;
      }> = {},
    ) => ({
      eventId: 'event-' + Math.random().toString(36).slice(2),
      ownerUserId: 'alice',
      sourceStorageKey: 'sources/alice/a.mp4',
      idempotencyKey: 'key-1',
      ...overrides,
    });

    it('creates on an unused key: one stored request carrying the key and one outbox entry', async () => {
      const result = await useCase.execute(input());

      expect(result.outcome).toBe('created');
      expect(result.request.idempotencyKey).toBe('key-1');
      await expect(
        repository.findByOwnerAndIdempotencyKey('alice', 'key-1'),
      ).resolves.toBe(result.request);
      await expect(repository.countByOwner('alice')).resolves.toBe(1);
      expect(outbox.recordedValidationRequests).toHaveLength(1);
      expect(outbox.recordedValidationRequests[0].processingRequestId).toBe(
        result.request.processingRequestId,
      );
    });

    it('replays the same key and source: the existing request, and nothing written', async () => {
      const first = await useCase.execute(input());
      const replayInput = input();

      const second = await useCase.execute(replayInput);

      expect(second.outcome).toBe('replayed');
      expect(second.request.processingRequestId).toBe(
        first.request.processingRequestId,
      );
      await expect(repository.countByOwner('alice')).resolves.toBe(1);
      expect(outbox.entries).toHaveLength(1);
      await expect(
        repository.hasEventBeenProcessed(replayInput.eventId),
      ).resolves.toBe(false);
    });

    it('rejects the same key with another source as a conflict, and writes nothing', async () => {
      await useCase.execute(input());
      const conflicting = input({ sourceStorageKey: 'sources/alice/b.mp4' });

      await expect(useCase.execute(conflicting)).rejects.toBeInstanceOf(
        IdempotencyConflictError,
      );
      await expect(repository.countByOwner('alice')).resolves.toBe(1);
      expect(outbox.entries).toHaveLength(1);
      await expect(
        repository.hasEventBeenProcessed(conflicting.eventId),
      ).resolves.toBe(false);
    });

    it.each([
      ['empty', ''],
      ['blank', '   '],
      ['missing', undefined as unknown as string],
    ])(
      'rejects a %s key with a domain error, and writes nothing',
      async (_label, idempotencyKey) => {
        const promise = useCase.execute(input({ idempotencyKey }));

        await expect(promise).rejects.toBeInstanceOf(
          ProcessingRequestDomainError,
        );
        await expect(promise).rejects.toThrow('idempotencyKey is required');
        await expect(repository.countByOwner('alice')).resolves.toBe(0);
        expect(outbox.entries).toHaveLength(0);
      },
    );

    it('gives two owners using the same key string a request each', async () => {
      const alices = await useCase.execute(input());
      const bobs = await useCase.execute(
        input({ ownerUserId: 'bob', sourceStorageKey: 'sources/bob/a.mp4' }),
      );

      expect(alices.outcome).toBe('created');
      expect(bobs.outcome).toBe('created');
      expect(bobs.request.processingRequestId).not.toBe(
        alices.request.processingRequestId,
      );
      expect(bobs.request.ownerUserId).toBe('bob');
      expect(outbox.recordedValidationRequests).toHaveLength(2);
    });

    it("returns the winner's request when its insert loses the race, and writes nothing", async () => {
      const winner = await useCase.execute(input());
      // The loser read before the winner committed, so its fast path saw
      // no request and it went on to insert.
      jest
        .spyOn(repository, 'findByOwnerAndIdempotencyKey')
        .mockResolvedValueOnce(undefined);

      const loser = await useCase.execute(input());

      expect(loser.outcome).toBe('replayed');
      expect(loser.request.processingRequestId).toBe(
        winner.request.processingRequestId,
      );
      await expect(repository.countByOwner('alice')).resolves.toBe(1);
      expect(outbox.entries).toHaveLength(1);
    });

    it('rejects a lost race for another source as a conflict', async () => {
      await useCase.execute(input());
      jest
        .spyOn(repository, 'findByOwnerAndIdempotencyKey')
        .mockResolvedValueOnce(undefined);

      await expect(
        useCase.execute(input({ sourceStorageKey: 'sources/alice/b.mp4' })),
      ).rejects.toBeInstanceOf(IdempotencyConflictError);
      expect(outbox.entries).toHaveLength(1);
    });
  });
});
