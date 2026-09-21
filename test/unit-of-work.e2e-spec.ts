import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import {
  ProcessingRequestStatus,
  createProcessingRequest,
} from '../src/domain/processing-request';
import { createDataSource } from '../src/infrastructure/persistence/data-source';
import { TypeOrmUnitOfWork } from '../src/infrastructure/persistence/typeorm-unit-of-work';

const describeIfDatabase = process.env.DATABASE_HOST ? describe : describe.skip;

describeIfDatabase('TypeOrmUnitOfWork', () => {
  let dataSource: DataSource;
  let unitOfWork: TypeOrmUnitOfWork;

  beforeAll(async () => {
    dataSource = createDataSource();
    await dataSource.initialize();
    await dataSource.runMigrations();
    unitOfWork = new TypeOrmUnitOfWork(dataSource);
  }, 30_000);

  afterAll(async () => {
    await dataSource.destroy();
  }, 30_000);

  const newRequest = () =>
    createProcessingRequest({
      ownerUserId: 'user-' + randomUUID(),
      sourceStorageKey: 'videos/input.mp4',
    });

  const countRows = async (table: string, column: string, value: string) => {
    const rows: { n: number }[] = await dataSource.query(
      `SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`,
      [value],
    );
    return rows[0].n;
  };

  it('commits the state, the deduplication record and the outbox row together', async () => {
    const request = newRequest();
    const eventId = randomUUID();

    await unitOfWork.runInTransaction(async (ctx) => {
      await ctx.requests.save(request);
      await ctx.outbox.add('video-validation', 'VideoValidationRequested', {
        eventId,
        processingRequestId: request.processingRequestId,
      });
      await ctx.requests.markEventProcessed(
        eventId,
        request.processingRequestId,
      );
    });

    expect(
      await countRows(
        'processing_request',
        'processing_request_id',
        request.processingRequestId,
      ),
    ).toBe(1);
    expect(await countRows('processed_event', 'event_id', eventId)).toBe(1);

    const outbox: { n: number }[] = await dataSource.query(
      `SELECT count(*)::int AS n FROM outbox
       WHERE payload->>'processingRequestId' = $1`,
      [request.processingRequestId],
    );
    expect(outbox[0].n).toBe(1);
  });

  it('rolls back all three when the work throws', async () => {
    const request = newRequest();
    const eventId = randomUUID();

    await expect(
      unitOfWork.runInTransaction(async (ctx) => {
        await ctx.requests.save(request);
        await ctx.outbox.add('video-validation', 'VideoValidationRequested', {
          eventId,
          processingRequestId: request.processingRequestId,
        });
        await ctx.requests.markEventProcessed(
          eventId,
          request.processingRequestId,
        );
        throw new Error('domain rejected the transition');
      }),
    ).rejects.toThrow('domain rejected the transition');

    // This is the guarantee the slice exists for: a committed state with an
    // uncommitted event, or the reverse, is exactly the loss being removed.
    expect(
      await countRows(
        'processing_request',
        'processing_request_id',
        request.processingRequestId,
      ),
    ).toBe(0);
    expect(await countRows('processed_event', 'event_id', eventId)).toBe(0);

    const outbox: { n: number }[] = await dataSource.query(
      `SELECT count(*)::int AS n FROM outbox
       WHERE payload->>'processingRequestId' = $1`,
      [request.processingRequestId],
    );
    expect(outbox[0].n).toBe(0);
  });

  it('writes nothing visible outside the transaction before it commits', async () => {
    const request = newRequest();
    let seenDuringTransaction = -1;

    await unitOfWork.runInTransaction(async (ctx) => {
      await ctx.requests.save(request);
      // Read through the outer data source, which is a different connection.
      seenDuringTransaction = await countRows(
        'processing_request',
        'processing_request_id',
        request.processingRequestId,
      );
    });

    expect(seenDuringTransaction).toBe(0);
    expect(
      await countRows(
        'processing_request',
        'processing_request_id',
        request.processingRequestId,
      ),
    ).toBe(1);
  });

  it('records the outbox row as pending', async () => {
    const request = newRequest();

    await unitOfWork.runInTransaction(async (ctx) => {
      await ctx.requests.save(request);
      await ctx.outbox.add('processing', 'ProcessingQueued', {
        processingRequestId: request.processingRequestId,
        status: ProcessingRequestStatus.QUEUED,
      });
    });

    const rows: { published_at: Date | null }[] = await dataSource.query(
      `SELECT published_at FROM outbox
       WHERE payload->>'processingRequestId' = $1`,
      [request.processingRequestId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].published_at).toBeNull();
  });
});
