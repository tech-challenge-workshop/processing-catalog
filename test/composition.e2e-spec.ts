import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { UNIT_OF_WORK } from '../src/application/unit-of-work';
import { DATA_SOURCE } from '../src/infrastructure/persistence/data-source';
import { TypeOrmProcessingRequestRepository } from '../src/infrastructure/persistence/typeorm-processing-request.repository';
import { TypeOrmUnitOfWork } from '../src/infrastructure/persistence/typeorm-unit-of-work';
import { InMemoryProcessingRequestRepository } from '../src/infrastructure/in-memory-processing-request.repository';
import { InMemoryUnitOfWork } from '../src/infrastructure/in-memory-unit-of-work';
import { RabbitMQConnection } from '../src/infrastructure/rabbitmq/rabbitmq.connection';

/**
 * The composition root is the one place a slice can be fully implemented and
 * still do nothing. Every PostgreSQL class here was tested and green while the
 * module kept selecting the in-memory ones, so the stack ran without a single
 * table. These tests assert the selection itself.
 */
class SilentConnection {
  isConnected(): boolean {
    return true;
  }
  sendToQueue(): Promise<void> {
    return Promise.resolve();
  }
  getConsumeChannel() {
    return { consume: () => Promise.resolve({ consumerTag: 'x' }) };
  }
  onModuleInit(): void {}
  onModuleDestroy(): Promise<void> {
    return Promise.resolve();
  }
}

async function bootWith(databaseHost: string | undefined) {
  const previous = process.env.DATABASE_HOST;
  if (databaseHost === undefined) {
    delete process.env.DATABASE_HOST;
  } else {
    process.env.DATABASE_HOST = databaseHost;
  }

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RabbitMQConnection)
    .useValue(new SilentConnection())
    .compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return {
    app,
    restore: () => {
      if (previous === undefined) {
        delete process.env.DATABASE_HOST;
      } else {
        process.env.DATABASE_HOST = previous;
      }
    },
  };
}

describe('composition root', () => {
  let app: INestApplication | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    await app?.close();
    restore?.();
    app = undefined;
    restore = undefined;
  });

  it('selects the in-memory repository when no database is configured', async () => {
    ({ app, restore } = await bootWith(undefined));

    expect(app.get('ProcessingRequestRepository')).toBeInstanceOf(
      InMemoryProcessingRequestRepository,
    );
    expect(app.get(UNIT_OF_WORK)).toBeInstanceOf(InMemoryUnitOfWork);
    expect(app.get(DATA_SOURCE, { strict: false })).toBeUndefined();
  }, 30_000);

  const describeIfDatabase = process.env.DATABASE_HOST
    ? describe
    : describe.skip;

  describeIfDatabase('with a database configured', () => {
    it('selects PostgreSQL for the repository and the unit of work', async () => {
      ({ app, restore } = await bootWith('localhost'));

      expect(app.get('ProcessingRequestRepository')).toBeInstanceOf(
        TypeOrmProcessingRequestRepository,
      );
      expect(app.get(UNIT_OF_WORK)).toBeInstanceOf(TypeOrmUnitOfWork);
    }, 30_000);

    it('applies the migrations at boot, so the tables exist', async () => {
      ({ app, restore } = await bootWith('localhost'));

      const dataSource = app.get<DataSource | undefined>(DATA_SOURCE, {
        strict: false,
      });
      expect(dataSource).toBeDefined();
      await expect(dataSource!.showMigrations()).resolves.toBe(false);

      const rows: { table_name: string }[] = await dataSource!.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'catalog' AND table_name <> 'migrations'
          ORDER BY table_name`,
      );
      expect(rows.map((r) => r.table_name)).toEqual([
        'outbox',
        'processed_event',
        'processing_request',
      ]);
    }, 30_000);
  });
});
