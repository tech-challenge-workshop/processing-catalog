import { DataSource } from 'typeorm';
import { applyE2eDatabaseName } from './e2e-database-name';

// Creates the e2e database and its `catalog` schema before any suite runs.
// The `catalog` role is cluster-wide (the platform's 01-schemas.sql creates
// it), so only the database and the schema are made here, as the admin user;
// the suites' migrations then run as `catalog`, as they do against the stack.
export default async function globalSetup(): Promise<void> {
  const name = applyE2eDatabaseName();
  if (!process.env.DATABASE_HOST || !name) {
    return;
  }

  const owner = process.env.DATABASE_USER ?? 'catalog';
  const schema = process.env.DATABASE_SCHEMA ?? 'catalog';

  await asAdmin('postgres', async (admin) => {
    const existing: unknown[] = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [name],
    );
    if (existing.length === 0) {
      await admin.query(`CREATE DATABASE ${quote(name)} OWNER ${quote(owner)}`);
    }
  });

  await asAdmin(name, (admin) =>
    admin.query(
      `CREATE SCHEMA IF NOT EXISTS ${quote(schema)} AUTHORIZATION ${quote(owner)}`,
    ),
  );
}

async function asAdmin(
  database: string,
  work: (admin: DataSource) => Promise<unknown>,
): Promise<void> {
  const admin = new DataSource({
    type: 'postgres',
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT ?? 5432),
    username: process.env.DATABASE_ADMIN_USER ?? 'postgres',
    password: process.env.DATABASE_ADMIN_PASSWORD ?? 'postgres',
    database,
  });
  await admin.initialize();
  try {
    await work(admin);
  } finally {
    await admin.destroy();
  }
}

function quote(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}
