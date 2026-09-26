import { DataSource } from 'typeorm';
import { createDataSource } from '../src/infrastructure/persistence/data-source';

const configured = Boolean(process.env.DATABASE_HOST);
const describeIfDatabase = configured ? describe : describe.skip;

const MIGRATION = 'IndexProcessingRequestOwnerCreatedAt1789955000000';

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

describeIfDatabase('owner index migration', () => {
  let dataSource: DataSource;

  const indexes = async (): Promise<Record<string, string>> => {
    const rows: { indexname: string; indexdef: string }[] =
      await dataSource.query(
        `SELECT indexname, indexdef FROM pg_indexes
          WHERE schemaname = 'catalog' AND tablename = 'processing_request'`,
      );
    return Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
  };

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

  it('replaces the owner-only index with the ordered composite one', async () => {
    const after = await indexes();

    expect(after['idx_processing_request_owner_created']).toMatch(
      /\(owner_user_id, created_at DESC, processing_request_id\)/,
    );
    expect(after['idx_processing_request_owner']).toBeUndefined();
  });

  it('restores the owner-only index when reverted, and reapplies cleanly', async () => {
    // Step back past migrations added after this one; afterAll and the
    // reapply below restore them.
    await undoMigrationsAfter(dataSource, MIGRATION);
    const executed: { name: string }[] = await dataSource.query(
      'SELECT name FROM migrations ORDER BY timestamp DESC LIMIT 1',
    );
    expect(executed[0].name).toBe(MIGRATION);

    await dataSource.undoLastMigration();
    const reverted = await indexes();

    expect(reverted['idx_processing_request_owner']).toMatch(
      /\(owner_user_id\)/,
    );
    expect(reverted['idx_processing_request_owner_created']).toBeUndefined();

    await dataSource.runMigrations();
    const reapplied = await indexes();

    expect(reapplied['idx_processing_request_owner_created']).toBeDefined();
    expect(reapplied['idx_processing_request_owner']).toBeUndefined();
  }, 30_000);

  it('leaves nothing pending when the migrations run a second time', async () => {
    await dataSource.runMigrations();

    await expect(dataSource.showMigrations()).resolves.toBe(false);
  }, 30_000);
});
