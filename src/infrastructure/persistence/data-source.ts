import { DataSource, DataSourceOptions } from 'typeorm';
import { ProcessingRequestEntity } from './processing-request.entity';
import { ProcessedEventEntity } from './processed-event.entity';
import { OutboxEntity } from './outbox.entity';

export const DATA_SOURCE = 'DATA_SOURCE';

/**
 * Whether a database is configured at all.
 *
 * The service still boots without one, falling back to the in-memory
 * repository, so the unit suite and a bare `npm start` need no container.
 */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_HOST);
}

export function buildDataSourceOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: Number(process.env.DATABASE_PORT ?? 5432),
    database: process.env.DATABASE_NAME ?? 'fiapx',
    schema: process.env.DATABASE_SCHEMA ?? 'catalog',
    username: process.env.DATABASE_USER ?? 'catalog',
    password: process.env.DATABASE_PASSWORD ?? 'catalog',
    entities: [ProcessingRequestEntity, ProcessedEventEntity, OutboxEntity],
    migrations: [__dirname + '/migrations/*.{ts,js}'],
    // Off on purpose: migrations are the only way this schema changes, so a
    // running service can never silently reshape a table under itself.
    synchronize: false,
    logging: false,
  };
}

export function createDataSource(): DataSource {
  return new DataSource(buildDataSourceOptions());
}
