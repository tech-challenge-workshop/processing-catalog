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
import { OutboxRelay } from '../src/infrastructure/messaging/outbox-relay';
import { RabbitMQConnection } from '../src/infrastructure/rabbitmq/rabbitmq.connection';

const describeIfDatabase = process.env.DATABASE_HOST ? describe : describe.skip;

class RecordingConnection {
  readonly sent: { queue: string; pattern: string; payload: unknown }[] = [];
  reachable = true;

  sendToQueue(queue: string, pattern: string, payload: unknown): Promise<void> {
    if (!this.reachable) {
      return Promise.reject(new Error('broker unreachable'));
    }
    this.sent.push({ queue, pattern, payload });
    return Promise.resolve();
  }
}

describeIfDatabase('durability', () => {
  let dataSource: DataSource;
  let repository: TypeOrmProcessingRequestRepository;
  let unitOfWork: TypeOrmUnitOfWork;
  let connection: RecordingConnection;
  let relay: OutboxRelay;

  beforeAll(async () => {
    dataSource = createDataSource();
    await dataSource.initialize();
    await dataSource.runMigrations();
  }, 30_000);

  afterAll(async () => {
    await dataSource.destroy();
  }, 30_000);

  beforeEach(async () => {
    await dataSource.query('DELETE FROM outbox');
    repository = TypeOrmProcessingRequestRepository.fromDataSource(dataSource);
    unitOfWork = new TypeOrmUnitOfWork(dataSource);
    connection = new RecordingConnection();
    relay = new OutboxRelay(
      dataSource,
      connection as unknown as RabbitMQConnection,
    );
  });

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

  it('keeps a request in PROCESSING across a new connection', async () => {
    const id = await aQueuedRequest();
    const startEventId = randomUUID();

    await new StartProcessingRequestUseCase(repository, unitOfWork).execute({
      eventId: startEventId,
      processingRequestId: id,
      occurredAt: new Date().toISOString(),
    });

    // A second data source is the closest thing to a restart that a test can
    // stage: nothing in process memory carries the answer.
    const reopened = createDataSource();
    await reopened.initialize();
    try {
      const reread =
        await TypeOrmProcessingRequestRepository.fromDataSource(
          reopened,
        ).findByProcessingRequestId(id);

      expect(reread!.status).toBe(ProcessingRequestStatus.PROCESSING);
      expect(reread!.attemptId).toBeDefined();
      expect(
        await TypeOrmProcessingRequestRepository.fromDataSource(
          reopened,
        ).hasEventBeenProcessed(startEventId),
      ).toBe(true);
    } finally {
      await reopened.destroy();
    }
  }, 30_000);

  it('applies no second transition when every event is replayed after a restart', async () => {
    const id = await aQueuedRequest();
    const startEventId = randomUUID();
    const start = new StartProcessingRequestUseCase(repository, unitOfWork);

    await start.execute({
      eventId: startEventId,
      processingRequestId: id,
      occurredAt: new Date().toISOString(),
    });
    const pendingAfterFirst = await relay.pendingCount();

    // Replay through a repository built on a fresh connection, as a restarted
    // consumer would.
    const reopened = createDataSource();
    await reopened.initialize();
    try {
      const freshRepo =
        TypeOrmProcessingRequestRepository.fromDataSource(reopened);
      await new StartProcessingRequestUseCase(
        freshRepo,
        new TypeOrmUnitOfWork(reopened),
      ).execute({
        eventId: startEventId,
        processingRequestId: id,
        occurredAt: new Date().toISOString(),
      });

      const reread = await freshRepo.findByProcessingRequestId(id);
      expect(reread!.status).toBe(ProcessingRequestStatus.PROCESSING);
    } finally {
      await reopened.destroy();
    }

    expect(await relay.pendingCount()).toBe(pendingAfterFirst);
  }, 30_000);

  it('loses no event while the broker is down, and delivers every one when it returns', async () => {
    const id = await aQueuedRequest();
    await new StartProcessingRequestUseCase(repository, unitOfWork).execute({
      eventId: randomUUID(),
      processingRequestId: id,
      occurredAt: new Date().toISOString(),
    });

    connection.reachable = false;

    await new CompleteProcessingRequestUseCase(repository, unitOfWork).execute({
      eventId: randomUUID(),
      processingRequestId: id,
      zipStorageKey: 'zips/output.zip',
      occurredAt: new Date().toISOString(),
    });

    // The transition committed even though the broker is unreachable.
    const stored = await repository.findByProcessingRequestId(id);
    expect(stored!.status).toBe(ProcessingRequestStatus.COMPLETED);

    await expect(relay.drain()).rejects.toThrow('broker unreachable');
    expect(connection.sent).toHaveLength(0);
    const pending = await relay.pendingCount();
    expect(pending).toBeGreaterThan(0);

    connection.reachable = true;
    const published = await relay.drain();

    expect(published).toBe(pending);
    expect(await relay.pendingCount()).toBe(0);
    const terminal = connection.sent.find(
      (s) => s.pattern === 'terminal.event',
    );
    expect(terminal).toBeDefined();
    expect((terminal!.payload as { status: string }).status).toBe('COMPLETED');
  }, 30_000);

  it('publishes each event exactly once when the broker never fails', async () => {
    const id = await aQueuedRequest();
    await new StartProcessingRequestUseCase(repository, unitOfWork).execute({
      eventId: randomUUID(),
      processingRequestId: id,
      occurredAt: new Date().toISOString(),
    });
    await new CompleteProcessingRequestUseCase(repository, unitOfWork).execute({
      eventId: randomUUID(),
      processingRequestId: id,
      zipStorageKey: 'zips/output.zip',
      occurredAt: new Date().toISOString(),
    });

    await relay.drain();
    const afterFirstDrain = connection.sent.length;
    await relay.drain();

    expect(connection.sent).toHaveLength(afterFirstDrain);
    expect(await relay.pendingCount()).toBe(0);
  }, 30_000);

  it('writes nothing anywhere when the transition is rejected', async () => {
    const request = createProcessingRequest({
      ownerUserId: 'user-' + randomUUID(),
      sourceStorageKey: 'videos/input.mp4',
    });
    await repository.save(request);
    const id = request.processingRequestId;
    const eventId = randomUUID();

    // Nothing can complete before the video was accepted.
    await expect(
      new CompleteProcessingRequestUseCase(repository, unitOfWork).execute({
        eventId,
        processingRequestId: id,
        zipStorageKey: 'zips/output.zip',
        occurredAt: new Date().toISOString(),
      }),
    ).rejects.toThrow('Cannot complete request in RECEIVED status');

    const stored = await repository.findByProcessingRequestId(id);
    expect(stored!.status).toBe(ProcessingRequestStatus.RECEIVED);
    expect(await repository.hasEventBeenProcessed(eventId)).toBe(false);

    const rows: { n: number }[] = await dataSource.query(
      `SELECT count(*)::int AS n FROM outbox
        WHERE payload->>'eventId' = $1`,
      [eventId],
    );
    expect(rows[0].n).toBe(0);
  }, 30_000);
});
