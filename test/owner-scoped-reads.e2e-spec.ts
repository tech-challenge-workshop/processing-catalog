import { randomUUID } from 'crypto';
import { AbstractLogger, DataSource, LogLevel, LogMessage } from 'typeorm';
import {
  ProcessingRequest,
  createProcessingRequest,
} from '../src/domain/processing-request';
import { buildDataSourceOptions } from '../src/infrastructure/persistence/data-source';
import { TypeOrmProcessingRequestRepository } from '../src/infrastructure/persistence/typeorm-processing-request.repository';

const configured = Boolean(process.env.DATABASE_HOST);
const describeIfDatabase = configured ? describe : describe.skip;

/** Records every SQL statement, so a test can see where the filter lives. */
class CapturingLogger extends AbstractLogger {
  readonly queries: string[] = [];

  protected writeLog(level: LogLevel, message: LogMessage | LogMessage[]) {
    for (const m of Array.isArray(message) ? message : [message]) {
      if (m.type === 'query' && typeof m.message === 'string') {
        this.queries.push(m.message);
      }
    }
  }
}

describeIfDatabase(
  'TypeOrmProcessingRequestRepository owner-scoped reads',
  () => {
    let dataSource: DataSource;
    let repository: TypeOrmProcessingRequestRepository;
    const logger = new CapturingLogger(['query']);

    beforeAll(async () => {
      dataSource = new DataSource({
        ...buildDataSourceOptions(),
        logging: ['query'],
        logger,
      });
      await dataSource.initialize();
      await dataSource.runMigrations();
      repository =
        TypeOrmProcessingRequestRepository.fromDataSource(dataSource);
    }, 30_000);

    afterAll(async () => {
      await dataSource.destroy();
    }, 30_000);

    // The database outlives a run, so every test owns fresh owners.
    const owner = (name: string) => `${name}-${randomUUID()}`;
    const t = (minute: number) =>
      new Date(`2026-09-26T10:${String(minute).padStart(2, '0')}:00.000Z`);

    function ownedBy(
      ownerUserId: string,
      createdAt: Date,
      processingRequestId: string = randomUUID(),
    ): ProcessingRequest {
      return {
        ...createProcessingRequest({
          ownerUserId,
          // One source per request: an owner holds one request per source.
          sourceStorageKey: `videos/${processingRequestId}.mp4`,
        }),
        processingRequestId,
        createdAt,
        updatedAt: createdAt,
      };
    }

    const ids = (rows: ProcessingRequest[]) =>
      rows.map((r) => r.processingRequestId);

    it("returns disjoint, complete pages for two owners and counts only each owner's rows", async () => {
      const alice = owner('alice');
      const bob = owner('bob');
      const aliceRows = [1, 3, 5].map((m) => ownedBy(alice, t(m)));
      const bobRows = [2, 4].map((m) => ownedBy(bob, t(m)));
      for (const r of [...aliceRows, ...bobRows]) {
        await repository.save(r);
      }

      const alicePage = await repository.findPageByOwner(alice, 0, 100);
      const bobPage = await repository.findPageByOwner(bob, 0, 100);

      expect(ids(alicePage)).toEqual(ids([...aliceRows].reverse()));
      expect(ids(bobPage)).toEqual(ids([...bobRows].reverse()));
      expect(alicePage.every((r) => r.ownerUserId === alice)).toBe(true);
      expect(await repository.countByOwner(alice)).toBe(3);
      expect(await repository.countByOwner(bob)).toBe(2);
    });

    it('breaks a createdAt tie by processingRequestId ascending, whatever the insertion order', async () => {
      const alice = owner('alice');
      const [low, high] = [randomUUID(), randomUUID()].sort();
      await repository.save(ownedBy(alice, t(7), high));
      await repository.save(ownedBy(alice, t(7), low));

      const first = await repository.findPageByOwner(alice, 0, 10);
      const again = await repository.findPageByOwner(alice, 0, 10);

      expect(ids(first)).toEqual([low, high]);
      expect(ids(again)).toEqual([low, high]);
    });

    it('applies offset and limit after ordering', async () => {
      const alice = owner('alice');
      const rows = [1, 2, 3, 4, 5].map((m) => ownedBy(alice, t(m)));
      for (const r of [rows[2], rows[0], rows[4], rows[1], rows[3]]) {
        await repository.save(r);
      }

      const page = await repository.findPageByOwner(alice, 2, 2);

      // Newest first is minutes 5,4,3,2,1; offset 2, limit 2 -> 3,2.
      expect(ids(page)).toEqual([
        rows[2].processingRequestId,
        rows[1].processingRequestId,
      ]);
    });

    it('returns an empty page beyond the last one, with the count unchanged', async () => {
      const alice = owner('alice');
      await repository.save(ownedBy(alice, t(1)));
      await repository.save(ownedBy(alice, t(2)));

      expect(await repository.findPageByOwner(alice, 20, 20)).toEqual([]);
      expect(await repository.countByOwner(alice)).toBe(2);
    });

    it('returns an empty page and a zero count for an owner with no requests', async () => {
      const nobody = owner('nobody');

      expect(await repository.findPageByOwner(nobody, 0, 20)).toEqual([]);
      expect(await repository.countByOwner(nobody)).toBe(0);
    });

    it('finds a request by id for its owner and returns nothing for another owner', async () => {
      const alice = owner('alice');
      const bob = owner('bob');
      const aliceRequest = ownedBy(alice, t(1));
      await repository.save(aliceRequest);

      const own = await repository.findByIdAndOwner(
        aliceRequest.processingRequestId,
        alice,
      );

      expect(own?.processingRequestId).toBe(aliceRequest.processingRequestId);
      expect(own?.ownerUserId).toBe(alice);
      expect(
        await repository.findByIdAndOwner(
          aliceRequest.processingRequestId,
          bob,
        ),
      ).toBeUndefined();
      expect(
        await repository.findByIdAndOwner(randomUUID(), alice),
      ).toBeUndefined();
    });

    it('puts the owner filter, the order and the page bounds in the SQL itself', async () => {
      const alice = owner('alice');
      const request = ownedBy(alice, t(1));
      await repository.save(request);

      logger.queries.length = 0;
      await repository.findPageByOwner(alice, 0, 5);
      await repository.countByOwner(alice);
      await repository.findByIdAndOwner(request.processingRequestId, alice);
      const [page, count, byId] = logger.queries;

      // No load-then-filter: each statement carries the owner predicate, and
      // the page is ordered and bounded by PostgreSQL, not in memory.
      expect(page).toMatch(/WHERE .*"owner_user_id" = \$1/);
      expect(page).toMatch(
        /ORDER BY .*"created_at" DESC, .*"processing_request_id" ASC/,
      );
      expect(page).toMatch(/LIMIT 5/);
      expect(count).toMatch(/COUNT\(/i);
      expect(count).toMatch(/WHERE .*"owner_user_id" = \$1/);
      expect(byId).toMatch(/WHERE .*"processing_request_id" = \$1/);
      expect(byId).toMatch(/"owner_user_id" = \$2/);
    });
  },
);
