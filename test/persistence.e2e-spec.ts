import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import {
  ProcessingRequestStatus,
  acceptProcessingRequest,
  createProcessingRequest,
  failProcessingRequest,
} from '../src/domain/processing-request';
import { DuplicateIdempotencyKeyError } from '../src/domain/processing-request.repository';
import { createDataSource } from '../src/infrastructure/persistence/data-source';
import { TypeOrmProcessingRequestRepository } from '../src/infrastructure/persistence/typeorm-processing-request.repository';

const configured = Boolean(process.env.DATABASE_HOST);
const describeIfDatabase = configured ? describe : describe.skip;

describeIfDatabase('TypeOrmProcessingRequestRepository', () => {
  let dataSource: DataSource;
  let repository: TypeOrmProcessingRequestRepository;

  beforeAll(async () => {
    dataSource = createDataSource();
    await dataSource.initialize();
    await dataSource.runMigrations();
    repository = TypeOrmProcessingRequestRepository.fromDataSource(dataSource);
  }, 30_000);

  afterAll(async () => {
    await dataSource.destroy();
  }, 30_000);

  const newRequest = () =>
    createProcessingRequest({
      ownerUserId: 'user-' + randomUUID(),
      sourceStorageKey: 'videos/input.mp4',
    });

  it('round-trips every field of a saved request', async () => {
    const request = newRequest();

    await repository.save(request);
    const found = await repository.findByProcessingRequestId(
      request.processingRequestId,
    );

    expect(found).toBeDefined();
    expect(found!.ownerUserId).toBe(request.ownerUserId);
    expect(found!.sourceStorageKey).toBe(request.sourceStorageKey);
    expect(found!.status).toBe(ProcessingRequestStatus.RECEIVED);
    expect(found!.createdAt.toISOString()).toBe(
      request.createdAt.toISOString(),
    );
  });

  it('keeps an absent attemptId absent rather than turning it into an empty string', async () => {
    const request = newRequest();
    await repository.save(request);

    const found = await repository.findByProcessingRequestId(
      request.processingRequestId,
    );

    expect(found!.attemptId).toBeUndefined();
    expect(found!.zipStorageKey).toBeUndefined();
    expect(found!.failureCode).toBeUndefined();
  });

  it('round-trips the idempotency key, and keeps an absent key absent', async () => {
    const keyed = createProcessingRequest({
      ownerUserId: 'user-' + randomUUID(),
      sourceStorageKey: 'videos/input.mp4',
      idempotencyKey: 'key-' + randomUUID(),
    });
    const unkeyed = newRequest();
    await repository.save(keyed);
    await repository.save(unkeyed);

    const foundKeyed = await repository.findByProcessingRequestId(
      keyed.processingRequestId,
    );
    const foundUnkeyed = await repository.findByProcessingRequestId(
      unkeyed.processingRequestId,
    );

    expect(foundKeyed!.idempotencyKey).toBe(keyed.idempotencyKey);
    expect(foundUnkeyed!.idempotencyKey).toBeUndefined();
  });

  it('persists a transition with its attempt and failure code', async () => {
    const request = newRequest();
    await repository.save(request);
    const failed = failProcessingRequest(
      acceptProcessingRequest(request),
      'DURACAO_EXCEDIDA',
    );

    await repository.update(failed);
    const found = await repository.findByProcessingRequestId(
      request.processingRequestId,
    );

    expect(found!.status).toBe(ProcessingRequestStatus.FAILED);
    expect(found!.failureCode).toBe('DURACAO_EXCEDIDA');
    expect(found!.attemptId).toBe(failed.attemptId);
  });

  it('survives a new connection, which is what durability means here', async () => {
    const request = newRequest();
    await repository.save(request);

    const second = createDataSource();
    await second.initialize();
    try {
      const reread = await TypeOrmProcessingRequestRepository.fromDataSource(
        second,
      ).findByProcessingRequestId(request.processingRequestId);
      expect(reread!.ownerUserId).toBe(request.ownerUserId);
    } finally {
      await second.destroy();
    }
  }, 30_000);

  it('records a processed event and finds the request through it', async () => {
    const request = newRequest();
    const eventId = randomUUID();
    await repository.save(request);

    await repository.markEventProcessed(eventId, request.processingRequestId);

    expect(await repository.hasEventBeenProcessed(eventId)).toBe(true);
    const found = await repository.findByEventId(eventId);
    expect(found!.processingRequestId).toBe(request.processingRequestId);
  });

  it('rejects a duplicate event id at the primary key rather than writing twice', async () => {
    const eventId = randomUUID();
    await repository.markEventProcessed(eventId);

    await expect(repository.markEventProcessed(eventId)).rejects.toThrow();

    const rows: { n: number }[] = await dataSource.query(
      'SELECT count(*)::int AS n FROM processed_event WHERE event_id = $1',
      [eventId],
    );
    expect(rows[0].n).toBe(1);
  });

  it('reports an unknown event as not processed', async () => {
    expect(await repository.hasEventBeenProcessed(randomUUID())).toBe(false);
    expect(await repository.findByEventId(randomUUID())).toBeUndefined();
  });

  describe('idempotency keys', () => {
    const keyed = (ownerUserId: string, idempotencyKey: string) =>
      createProcessingRequest({
        ownerUserId,
        sourceStorageKey: `sources/${ownerUserId}/video.mp4`,
        idempotencyKey,
      });

    const countFor = async (ownerUserId: string, key: string) => {
      const rows: { n: number }[] = await dataSource.query(
        `SELECT count(*)::int AS n FROM processing_request
          WHERE owner_user_id = $1 AND idempotency_key = $2`,
        [ownerUserId, key],
      );
      return rows[0].n;
    };

    it("finds the owner's request by its key, and not another owner's", async () => {
      const owner = 'user-' + randomUUID();
      const key = 'key-' + randomUUID();
      const request = keyed(owner, key);
      await repository.save(request);

      const found = await repository.findByOwnerAndIdempotencyKey(owner, key);
      expect(found!.processingRequestId).toBe(request.processingRequestId);
      expect(found!.idempotencyKey).toBe(key);
      await expect(
        repository.findByOwnerAndIdempotencyKey('user-' + randomUUID(), key),
      ).resolves.toBeUndefined();
      await expect(
        repository.findByOwnerAndIdempotencyKey(owner, 'key-' + randomUUID()),
      ).resolves.toBeUndefined();
    });

    it('raises DuplicateIdempotencyKeyError on a second insert with the same owner and key', async () => {
      const owner = 'user-' + randomUUID();
      const key = 'key-' + randomUUID();
      await repository.save(keyed(owner, key));

      await expect(repository.save(keyed(owner, key))).rejects.toBeInstanceOf(
        DuplicateIdempotencyKeyError,
      );
      expect(await countFor(owner, key)).toBe(1);
    });

    it('saves the same key for two owners', async () => {
      const key = 'key-' + randomUUID();
      const alice = 'user-' + randomUUID();
      const bob = 'user-' + randomUUID();

      await repository.save(keyed(alice, key));
      await repository.save(keyed(bob, key));

      expect(await countFor(alice, key)).toBe(1);
      expect(await countFor(bob, key)).toBe(1);
    });

    it('does not map a unique violation on another constraint', async () => {
      const request = keyed('user-' + randomUUID(), 'key-' + randomUUID());
      await repository.save(request);
      // Same primary key, different key: 23505 on processing_request_pkey.
      const samePrimaryKey = {
        ...keyed('user-' + randomUUID(), 'key-' + randomUUID()),
        processingRequestId: request.processingRequestId,
      };

      const error: unknown = await repository.save(samePrimaryKey).then(
        () => undefined,
        (e: unknown) => e,
      );

      expect(error).not.toBeInstanceOf(DuplicateIdempotencyKeyError);
      expect(error).toMatchObject({
        driverError: { code: '23505', constraint: 'processing_request_pkey' },
      });
    });
  });

  it('applies the migrations twice with no change on the second run', async () => {
    const pending = await dataSource.showMigrations();

    expect(pending).toBe(false);
  });
});
