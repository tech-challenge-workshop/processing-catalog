import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import {
  CreateProcessingRequestInput,
  CreateProcessingRequestUseCase,
  IdempotencyConflictError,
} from '../src/application/create-processing-request.use-case';
import {
  DuplicateIdempotencyKeyError,
  DuplicateSourceError,
} from '../src/domain/processing-request.repository';
import { createDataSource } from '../src/infrastructure/persistence/data-source';
import { TypeOrmProcessingRequestRepository } from '../src/infrastructure/persistence/typeorm-processing-request.repository';
import { TypeOrmUnitOfWork } from '../src/infrastructure/persistence/typeorm-unit-of-work';

const describeIfDatabase = process.env.DATABASE_HOST ? describe : describe.skip;

describeIfDatabase('idempotent creation (PostgreSQL)', () => {
  let dataSource: DataSource;
  let repository: TypeOrmProcessingRequestRepository;
  let useCase: CreateProcessingRequestUseCase;

  beforeAll(async () => {
    dataSource = createDataSource();
    await dataSource.initialize();
    await dataSource.runMigrations();
    repository = TypeOrmProcessingRequestRepository.fromDataSource(dataSource);
    useCase = new CreateProcessingRequestUseCase(
      repository,
      new TypeOrmUnitOfWork(dataSource),
    );
  }, 30_000);

  afterAll(async () => {
    await dataSource.destroy();
  }, 30_000);

  // The database outlives a run, so every test owns a fresh owner. Each call
  // gets its own eventId, as the controller gives it one.
  const create = (
    ownerUserId: string,
    idempotencyKey: string,
    sourceStorageKey = `sources/${ownerUserId}/a.mp4`,
  ) => {
    const input: CreateProcessingRequestInput = {
      eventId: randomUUID(),
      ownerUserId,
      sourceStorageKey,
      idempotencyKey,
    };
    return useCase.execute(input);
  };

  const rows = async (ownerUserId: string): Promise<number> => {
    const r: { n: number }[] = await dataSource.query(
      'SELECT count(*)::int AS n FROM processing_request WHERE owner_user_id = $1',
      [ownerUserId],
    );
    return r[0].n;
  };

  const outboxEntries = async (ownerUserId: string): Promise<number> => {
    const r: { n: number }[] = await dataSource.query(
      `SELECT count(*)::int AS n FROM outbox
        WHERE pattern = 'VideoValidationRequested'
          AND payload->>'ownerUserId' = $1`,
      [ownerUserId],
    );
    return r[0].n;
  };

  it('leaves one row and one outbox entry for concurrent creates with one key, and every result carries its id; a later one is replayed', async () => {
    const owner = 'alice-' + randomUUID();
    const key = 'key-' + randomUUID();

    const concurrent = await Promise.all([
      create(owner, key),
      create(owner, key),
    ]);

    expect(await rows(owner)).toBe(1);
    expect(await outboxEntries(owner)).toBe(1);
    const [stored]: { processing_request_id: string }[] =
      await dataSource.query(
        'SELECT processing_request_id FROM processing_request WHERE owner_user_id = $1',
        [owner],
      );
    expect(concurrent.map((r) => r.request.processingRequestId)).toEqual([
      stored.processing_request_id,
      stored.processing_request_id,
    ]);
    expect(concurrent.map((r) => r.outcome).sort()).toEqual([
      'created',
      'replayed',
    ]);

    const later = await create(owner, key);

    expect(later.outcome).toBe('replayed');
    expect(later.request.processingRequestId).toBe(
      stored.processing_request_id,
    );
    expect(await rows(owner)).toBe(1);
    expect(await outboxEntries(owner)).toBe(1);
  }, 30_000);

  it('still leaves one row and one outbox entry under a wider burst', async () => {
    const owner = 'burst-' + randomUUID();
    const key = 'key-' + randomUUID();

    const results = await Promise.all(
      Array.from({ length: 8 }, () => create(owner, key)),
    );

    expect(await rows(owner)).toBe(1);
    expect(await outboxEntries(owner)).toBe(1);
    expect(
      new Set(results.map((r) => r.request.processingRequestId)).size,
    ).toBe(1);
    expect(results.filter((r) => r.outcome === 'created')).toHaveLength(1);
  }, 30_000);

  it("returns the winner's request after the unique index rejects the loser's insert, which leaves nothing behind", async () => {
    const owner = 'race-' + randomUUID();
    const key = 'key-' + randomUUID();
    const winner = await create(owner, key);
    // Force the loser past the fast path, as a create that read before the
    // winner committed would be: it inserts, PostgreSQL raises 23505 and
    // the transaction rolls back. Such a create misses both lookups, the
    // key's and the source's.
    jest
      .spyOn(repository, 'findByOwnerAndIdempotencyKey')
      .mockResolvedValueOnce(undefined);
    jest
      .spyOn(repository, 'findByOwnerAndSource')
      .mockResolvedValueOnce(undefined);
    const insert = jest.spyOn(
      TypeOrmProcessingRequestRepository.prototype,
      'save',
    );

    const loser = await create(owner, key);

    expect(insert).toHaveBeenCalledTimes(1);
    await expect(insert.mock.results[0].value).rejects.toBeInstanceOf(
      DuplicateIdempotencyKeyError,
    );
    expect(loser.outcome).toBe('replayed');
    expect(loser.request.processingRequestId).toBe(
      winner.request.processingRequestId,
    );
    expect(await rows(owner)).toBe(1);
    expect(await outboxEntries(owner)).toBe(1);
    insert.mockRestore();
  }, 30_000);

  it('rejects the key bound to another source and writes nothing', async () => {
    const owner = 'conflict-' + randomUUID();
    const key = 'key-' + randomUUID();
    await create(owner, key);

    await expect(
      create(owner, key, `sources/${owner}/b.mp4`),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(await rows(owner)).toBe(1);
    expect(await outboxEntries(owner)).toBe(1);
  }, 30_000);

  describe('one request per source', () => {
    it('leaves one row and one outbox entry for concurrent creates with two keys on one source, and both results carry its id', async () => {
      const owner = 'source-' + randomUUID();

      const concurrent = await Promise.all([
        create(owner, 'key-' + randomUUID()),
        create(owner, 'key-' + randomUUID()),
      ]);

      expect(await rows(owner)).toBe(1);
      expect(await outboxEntries(owner)).toBe(1);
      const [stored]: { processing_request_id: string }[] =
        await dataSource.query(
          'SELECT processing_request_id FROM processing_request WHERE owner_user_id = $1',
          [owner],
        );
      expect(concurrent.map((r) => r.request.processingRequestId)).toEqual([
        stored.processing_request_id,
        stored.processing_request_id,
      ]);
      expect(concurrent.map((r) => r.outcome).sort()).toEqual([
        'created',
        'replayed',
      ]);
    }, 30_000);

    it('still leaves one row and one outbox entry under a burst of eight keys on one source', async () => {
      const owner = 'source-burst-' + randomUUID();

      const results = await Promise.all(
        Array.from({ length: 8 }, () => create(owner, 'key-' + randomUUID())),
      );

      expect(await rows(owner)).toBe(1);
      expect(await outboxEntries(owner)).toBe(1);
      expect(
        new Set(results.map((r) => r.request.processingRequestId)).size,
      ).toBe(1);
      expect(results.filter((r) => r.outcome === 'created')).toHaveLength(1);
    }, 30_000);

    it("returns the winner's request after the source index rejects the loser's insert, which leaves nothing behind", async () => {
      const owner = 'source-race-' + randomUUID();
      const winner = await create(owner, 'key-' + randomUUID());
      // Force the loser past the source lookup, as a create that read
      // before the winner committed would be: it inserts under its own key,
      // PostgreSQL raises 23505 on the source index and the transaction
      // rolls back.
      jest
        .spyOn(repository, 'findByOwnerAndSource')
        .mockResolvedValueOnce(undefined);
      const insert = jest.spyOn(
        TypeOrmProcessingRequestRepository.prototype,
        'save',
      );
      const loserKey = 'key-' + randomUUID();

      const loser = await create(owner, loserKey);

      expect(insert).toHaveBeenCalledTimes(1);
      await expect(insert.mock.results[0].value).rejects.toBeInstanceOf(
        DuplicateSourceError,
      );
      expect(loser.outcome).toBe('replayed');
      expect(loser.request.processingRequestId).toBe(
        winner.request.processingRequestId,
      );
      expect(await rows(owner)).toBe(1);
      expect(await outboxEntries(owner)).toBe(1);
      const processed: { n: number }[] = await dataSource.query(
        `SELECT count(*)::int AS n FROM processed_event
          WHERE processing_request_id = $1`,
        [winner.request.processingRequestId],
      );
      expect(processed[0].n).toBe(1);
      insert.mockRestore();
    }, 30_000);
  });

  it('gives two owners using the same key string a request each', async () => {
    const key = 'key-' + randomUUID();
    const alice = 'alice-' + randomUUID();
    const bob = 'bob-' + randomUUID();

    const [a, b] = await Promise.all([create(alice, key), create(bob, key)]);

    expect(a.outcome).toBe('created');
    expect(b.outcome).toBe('created');
    expect(a.request.processingRequestId).not.toBe(
      b.request.processingRequestId,
    );
    expect(await rows(alice)).toBe(1);
    expect(await rows(bob)).toBe(1);
    expect(await outboxEntries(alice)).toBe(1);
    expect(await outboxEntries(bob)).toBe(1);
  }, 30_000);
});
