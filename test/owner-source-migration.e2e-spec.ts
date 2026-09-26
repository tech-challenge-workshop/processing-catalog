import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { createDataSource } from '../src/infrastructure/persistence/data-source';

const configured = Boolean(process.env.DATABASE_HOST);
const describeIfDatabase = configured ? describe : describe.skip;

const MIGRATION = 'UniqueOwnerSource1789957000000';
const INDEX = 'uq_processing_request_owner_source';

async function undoMigrationsAfter(
  dataSource: DataSource,
  name: string,
): Promise<void> {
  for (;;) {
    const last: { name: string }[] = await dataSource.query(
      'SELECT name FROM migrations ORDER BY timestamp DESC LIMIT 1',
    );
    if (last[0].name === name) {
      return;
    }
    await dataSource.undoLastMigration();
  }
}

describeIfDatabase('owner source migration', () => {
  let dataSource: DataSource;

  const indexDef = async (): Promise<string | undefined> => {
    const rows: { indexdef: string }[] = await dataSource.query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'catalog' AND tablename = 'processing_request'
          AND indexname = $1`,
      [INDEX],
    );
    return rows[0]?.indexdef;
  };

  const insert = (owner: string, source: string, key: string | null) =>
    dataSource.query(
      `INSERT INTO processing_request
         (processing_request_id, owner_user_id, source_storage_key, status,
          idempotency_key, created_at, updated_at)
       VALUES ($1, $2, $3, 'RECEIVED', $4, now(), now())`,
      [randomUUID(), owner, source, key],
    );

  beforeAll(async () => {
    dataSource = createDataSource();
    await dataSource.initialize();
    await dataSource.runMigrations();
  }, 30_000);

  afterAll(async () => {
    // Leave the shared database fully migrated for every other suite.
    await dataSource.runMigrations();
    await dataSource.destroy();
  }, 30_000);

  it('adds a unique index on (owner_user_id, source_storage_key)', async () => {
    expect(await indexDef()).toMatch(
      /^CREATE UNIQUE INDEX uq_processing_request_owner_source ON catalog\.processing_request USING btree \(owner_user_id, source_storage_key\)$/,
    );
  });

  it('removes the index when reverted, and reapplies cleanly', async () => {
    await undoMigrationsAfter(dataSource, MIGRATION);
    const executed: { name: string }[] = await dataSource.query(
      'SELECT name FROM migrations ORDER BY timestamp DESC LIMIT 1',
    );
    expect(executed[0].name).toBe(MIGRATION);

    await dataSource.undoLastMigration();
    expect(await indexDef()).toBeUndefined();

    await dataSource.runMigrations();
    expect(await indexDef()).toBeDefined();
  }, 30_000);

  it('rejects a second row with the same owner and source under another key', async () => {
    const owner = 'dup-' + randomUUID();
    const source = `sources/${owner}/a.mp4`;
    await insert(owner, source, 'key-1');

    await expect(insert(owner, source, 'key-2')).rejects.toMatchObject({
      driverError: { code: '23505', constraint: INDEX },
    });
  });

  it('rejects a second row with the same owner and source when both keys are NULL', async () => {
    const owner = 'nulls-' + randomUUID();
    const source = `sources/${owner}/a.mp4`;
    await insert(owner, source, null);

    await expect(insert(owner, source, null)).rejects.toMatchObject({
      driverError: { code: '23505', constraint: INDEX },
    });
  });

  it('accepts two owners with the same source string', async () => {
    const source = 'sources/shared-' + randomUUID() + '.mp4';
    const alice = 'alice-' + randomUUID();
    const bob = 'bob-' + randomUUID();

    await insert(alice, source, 'key-1');
    await insert(bob, source, 'key-1');

    const rows: { n: number }[] = await dataSource.query(
      `SELECT count(*)::int AS n FROM processing_request
        WHERE source_storage_key = $1`,
      [source],
    );
    expect(rows[0].n).toBe(2);
  });

  it('leaves nothing pending when the migrations run a second time', async () => {
    await dataSource.runMigrations();

    await expect(dataSource.showMigrations()).resolves.toBe(false);
  }, 30_000);
});
