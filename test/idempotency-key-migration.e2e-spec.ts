import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { createDataSource } from '../src/infrastructure/persistence/data-source';

const configured = Boolean(process.env.DATABASE_HOST);
const describeIfDatabase = configured ? describe : describe.skip;

const MIGRATION = 'AddIdempotencyKey1789956000000';
const INDEX = 'uq_processing_request_owner_idempotency';

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

describeIfDatabase('idempotency key migration', () => {
  let dataSource: DataSource;

  const column = async (): Promise<{ is_nullable: string } | undefined> => {
    const rows: { is_nullable: string }[] = await dataSource.query(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = 'catalog' AND table_name = 'processing_request'
          AND column_name = 'idempotency_key'`,
    );
    return rows[0];
  };

  const indexDef = async (): Promise<string | undefined> => {
    const rows: { indexdef: string }[] = await dataSource.query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'catalog' AND tablename = 'processing_request'
          AND indexname = $1`,
      [INDEX],
    );
    return rows[0]?.indexdef;
  };

  // Written as raw SQL on purpose: the row has to exist before the column
  // does, so the entity (which maps the column) cannot insert it.
  const insertWithoutKey = (id: string, owner: string) =>
    dataSource.query(
      `INSERT INTO processing_request
         (processing_request_id, owner_user_id, source_storage_key, status,
          created_at, updated_at)
       VALUES ($1, $2, 'sources/pre-s6.mp4', 'RECEIVED', now(), now())`,
      [id, owner],
    );

  // One source per row: an owner cannot hold two requests for one source
  // (uq_processing_request_owner_source), and only the key is under test here.
  const insertWithKey = (id: string, owner: string, key: string | null) =>
    dataSource.query(
      `INSERT INTO processing_request
         (processing_request_id, owner_user_id, source_storage_key, status,
          idempotency_key, created_at, updated_at)
       VALUES ($1, $2, $3, 'RECEIVED', $4, now(), now())`,
      [id, owner, `sources/s6-${id}.mp4`, key],
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

  it('adds a nullable idempotency_key and a unique index on (owner_user_id, idempotency_key)', async () => {
    expect(await column()).toEqual({ is_nullable: 'YES' });
    expect(await indexDef()).toMatch(
      /^CREATE UNIQUE INDEX uq_processing_request_owner_idempotency ON catalog\.processing_request USING btree \(owner_user_id, idempotency_key\)$/,
    );
  });

  it('removes both when reverted, and a pre-existing row survives the reapply with a NULL key', async () => {
    // Step back past migrations added after this one; afterAll and the
    // reapply below restore them.
    await undoMigrationsAfter(dataSource, MIGRATION);
    const executed: { name: string }[] = await dataSource.query(
      'SELECT name FROM migrations ORDER BY timestamp DESC LIMIT 1',
    );
    expect(executed[0].name).toBe(MIGRATION);

    await dataSource.undoLastMigration();
    expect(await column()).toBeUndefined();
    expect(await indexDef()).toBeUndefined();

    const owner = 'pre-s6-' + randomUUID();
    const preExisting = randomUUID();
    await insertWithoutKey(preExisting, owner);

    await dataSource.runMigrations();
    expect(await column()).toEqual({ is_nullable: 'YES' });
    expect(await indexDef()).toBeDefined();

    const rows: { idempotency_key: string | null }[] = await dataSource.query(
      `SELECT idempotency_key FROM processing_request
        WHERE processing_request_id = $1`,
      [preExisting],
    );
    expect(rows).toEqual([{ idempotency_key: null }]);
  }, 30_000);

  it('lets NULL-key rows of one owner coexist and never blocks a keyed insert', async () => {
    const owner = 'nulls-' + randomUUID();
    await insertWithKey(randomUUID(), owner, null);
    await insertWithKey(randomUUID(), owner, null);
    await insertWithKey(randomUUID(), owner, 'key-1');

    const rows: { nulls: number; keyed: number }[] = await dataSource.query(
      `SELECT count(*) FILTER (WHERE idempotency_key IS NULL)::int AS nulls,
              count(*) FILTER (WHERE idempotency_key = 'key-1')::int AS keyed
         FROM processing_request WHERE owner_user_id = $1`,
      [owner],
    );
    expect(rows[0]).toEqual({ nulls: 2, keyed: 1 });
  });

  it('rejects a second row with the same owner and key at the index', async () => {
    const owner = 'dup-' + randomUUID();
    await insertWithKey(randomUUID(), owner, 'key-1');

    await expect(
      insertWithKey(randomUUID(), owner, 'key-1'),
    ).rejects.toMatchObject({
      driverError: { code: '23505', constraint: INDEX },
    });
  });

  it('leaves nothing pending when the migrations run a second time', async () => {
    await dataSource.runMigrations();

    await expect(dataSource.showMigrations()).resolves.toBe(false);
  }, 30_000);
});
