import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import {
  ProcessingRequestStatus,
  createProcessingRequest,
} from '../src/domain/processing-request';
import { AcceptProcessingRequestUseCase } from '../src/application/accept-processing-request.use-case';
import { StartProcessingRequestUseCase } from '../src/application/start-processing-request.use-case';
import { CompleteProcessingRequestUseCase } from '../src/application/complete-processing-request.use-case';
import { createDataSource } from '../src/infrastructure/persistence/data-source';
import { TypeOrmProcessingRequestRepository } from '../src/infrastructure/persistence/typeorm-processing-request.repository';
import { TypeOrmUnitOfWork } from '../src/infrastructure/persistence/typeorm-unit-of-work';

const describeIfDatabase = process.env.DATABASE_HOST ? describe : describe.skip;

/**
 * ProcessingStarted and ProcessingCompleted travel on different queues, so the
 * Catalog can handle them in either order or at the same time. These tests
 * run against PostgreSQL because the guarantee is a row lock: an in-memory
 * double has no concurrent writer and would pass without proving anything.
 */
describeIfDatabase('lifecycle ordering', () => {
  let dataSource: DataSource;
  let repository: TypeOrmProcessingRequestRepository;
  let unitOfWork: TypeOrmUnitOfWork;

  beforeAll(async () => {
    dataSource = createDataSource();
    await dataSource.initialize();
    await dataSource.runMigrations();
    repository = TypeOrmProcessingRequestRepository.fromDataSource(dataSource);
    unitOfWork = new TypeOrmUnitOfWork(dataSource);
  }, 30_000);

  afterAll(async () => {
    await dataSource.destroy();
  }, 30_000);

  const aQueuedRequest = async () => {
    const request = createProcessingRequest({
      ownerUserId: 'user-' + randomUUID(),
      sourceStorageKey: 'videos/input.mp4',
    });
    await repository.save(request);
    await new AcceptProcessingRequestUseCase(repository, unitOfWork).execute({
      eventId: randomUUID(),
      processingRequestId: request.processingRequestId,
      occurredAt: new Date().toISOString(),
    });
    return request.processingRequestId;
  };

  const start = (id: string, eventId: string = randomUUID()) =>
    new StartProcessingRequestUseCase(repository, unitOfWork).execute({
      eventId,
      processingRequestId: id,
      occurredAt: new Date().toISOString(),
    });

  const complete = (
    id: string,
    eventId: string = randomUUID(),
    zipStorageKey = `zips/${id}.zip`,
  ) =>
    new CompleteProcessingRequestUseCase(repository, unitOfWork).execute({
      eventId,
      processingRequestId: id,
      zipStorageKey,
      occurredAt: new Date().toISOString(),
    });

  const terminalRows = async (id: string): Promise<number> => {
    const rows: { n: number }[] = await dataSource.query(
      `SELECT count(*)::int AS n FROM outbox
        WHERE pattern = 'terminal.event'
          AND payload->>'processingRequestId' = $1`,
      [id],
    );
    return rows[0].n;
  };

  it('completes a request whose completion is handled before its start', async () => {
    const id = await aQueuedRequest();

    await complete(id);
    const startEventId = randomUUID();
    await start(id, startEventId);

    const stored = await repository.findByProcessingRequestId(id);
    expect(stored!.status).toBe(ProcessingRequestStatus.COMPLETED);
    expect(await terminalRows(id)).toBe(1);
    // The late start is recorded as seen, so its redelivery is a duplicate
    // rather than another stale start to reason about.
    expect(await repository.hasEventBeenProcessed(startEventId)).toBe(true);
  }, 30_000);

  it('ends COMPLETED with one terminal event when start and completion race', async () => {
    const ids = await Promise.all(
      Array.from({ length: 20 }, () => aQueuedRequest()),
    );

    // Both events for each request run concurrently. Without the row lock
    // both read QUEUED, and a start committing after the completion would
    // move the request back to PROCESSING with its terminal event already
    // recorded.
    await Promise.all(ids.flatMap((id) => [start(id), complete(id)]));

    for (const id of ids) {
      const stored = await repository.findByProcessingRequestId(id);
      expect(stored!.status).toBe(ProcessingRequestStatus.COMPLETED);
      expect(await terminalRows(id)).toBe(1);
    }
  }, 60_000);

  it('absorbs the same completion reported under a new eventId', async () => {
    const id = await aQueuedRequest();
    await start(id);

    await complete(id, randomUUID(), 'zips/same.zip');
    await complete(id, randomUUID(), 'zips/same.zip');

    const stored = await repository.findByProcessingRequestId(id);
    expect(stored!.status).toBe(ProcessingRequestStatus.COMPLETED);
    expect(await terminalRows(id)).toBe(1);
  }, 30_000);

  it('processes a concurrent redelivery of the same event once', async () => {
    const id = await aQueuedRequest();
    await start(id);
    const eventId = randomUUID();

    await Promise.all([complete(id, eventId), complete(id, eventId)]);

    expect(await terminalRows(id)).toBe(1);
  }, 30_000);
});
