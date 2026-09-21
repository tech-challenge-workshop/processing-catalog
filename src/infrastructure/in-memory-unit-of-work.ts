import {
  OutboxWriter,
  TransactionContext,
  UnitOfWork,
} from '../application/unit-of-work';
import { InMemoryProcessingRequestRepository } from './in-memory-processing-request.repository';

export interface RecordedOutboxEntry {
  queue: string;
  pattern: string;
  payload: Record<string, unknown>;
}

export class InMemoryOutboxWriter implements OutboxWriter {
  readonly entries: RecordedOutboxEntry[] = [];

  add(
    queue: string,
    pattern: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    this.entries.push({ queue, pattern, payload });
    return Promise.resolve();
  }

  clear(): void {
    this.entries.length = 0;
  }
}

/**
 * The unit-test implementation. It invokes the work directly.
 *
 * IT CANNOT ROLL BACK. A test asserting atomicity through this class would
 * pass without proving anything, so atomicity is asserted only against
 * PostgreSQL, in the integration suite.
 */
export class InMemoryUnitOfWork implements UnitOfWork {
  constructor(
    private readonly requests: InMemoryProcessingRequestRepository,
    readonly outbox: InMemoryOutboxWriter = new InMemoryOutboxWriter(),
  ) {}

  runInTransaction<T>(
    work: (ctx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    const ctx: TransactionContext = {
      requests: this.requests,
      outbox: this.outbox,
    };
    return work(ctx);
  }
}
