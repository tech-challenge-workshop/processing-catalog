import { DataSource, EntityManager } from 'typeorm';
import {
  OutboxWriter,
  TransactionContext,
  UnitOfWork,
} from '../../application/unit-of-work';
import { TypeOrmProcessingRequestRepository } from './typeorm-processing-request.repository';

class TransactionalOutboxWriter implements OutboxWriter {
  constructor(private readonly manager: EntityManager) {}

  async add(
    queue: string,
    pattern: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    // A parameterised insert rather than the entity mapper: `id` is generated
    // and the payload is an arbitrary JSON document, which TypeORM's
    // DeepPartial typing cannot express without casting the shape away. For
    // an append-only table this states exactly what is written.
    await this.manager.query(
      `INSERT INTO outbox (queue, pattern, payload, created_at, published_at)
       VALUES ($1, $2, $3::jsonb, now(), NULL)`,
      [queue, pattern, JSON.stringify(payload)],
    );
  }
}

export class TypeOrmUnitOfWork implements UnitOfWork {
  constructor(private readonly dataSource: DataSource) {}

  runInTransaction<T>(
    work: (ctx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    // TypeORM commits when the callback resolves and rolls back when it
    // throws, so a domain error inside the work leaves no row behind in any
    // of the three tables.
    return this.dataSource.transaction((manager) =>
      work({
        requests: new TypeOrmProcessingRequestRepository(manager),
        outbox: new TransactionalOutboxWriter(manager),
      }),
    );
  }
}
