import { createDataSource } from '../src/infrastructure/persistence/data-source';
import { resolveE2eDatabaseName } from './support/e2e-database-name';

const describeIfDatabase = process.env.DATABASE_HOST ? describe : describe.skip;

describe('e2e database name', () => {
  it('defaults to fiapx_e2e when a database host is set and no name is', () => {
    expect(resolveE2eDatabaseName({ DATABASE_HOST: 'localhost' })).toBe(
      'fiapx_e2e',
    );
  });

  it('keeps an explicit name other than the stack database', () => {
    expect(
      resolveE2eDatabaseName({
        DATABASE_HOST: 'localhost',
        DATABASE_NAME: 'other_e2e',
      }),
    ).toBe('other_e2e');
  });

  it('refuses the stack database, naming the variable', () => {
    expect(() =>
      resolveE2eDatabaseName({
        DATABASE_HOST: 'localhost',
        DATABASE_NAME: 'fiapx',
      }),
    ).toThrow(
      "e2e suites must not run against the stack's database (DATABASE_NAME=fiapx)",
    );
  });

  it('refuses the stack database even without a host', () => {
    expect(() => resolveE2eDatabaseName({ DATABASE_NAME: 'fiapx' })).toThrow(
      "e2e suites must not run against the stack's database (DATABASE_NAME=fiapx)",
    );
  });

  it('leaves the name unset when no database is configured', () => {
    expect(resolveE2eDatabaseName({})).toBeUndefined();
  });
});

describeIfDatabase('e2e database connection', () => {
  it('connects the suites to the e2e database, never to fiapx', async () => {
    const dataSource = createDataSource();
    await dataSource.initialize();
    try {
      const rows: { name: string }[] = await dataSource.query(
        'SELECT current_database() AS name',
      );
      // The setup file has already resolved the name (fiapx_e2e unless the
      // run chose another); the connection must follow it.
      expect(process.env.DATABASE_NAME).toBeDefined();
      expect(rows[0].name).toBe(process.env.DATABASE_NAME);
      expect(rows[0].name).not.toBe('fiapx');
    } finally {
      await dataSource.destroy();
    }
  });
});
