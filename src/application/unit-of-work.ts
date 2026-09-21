import { ProcessingRequestRepository } from '../domain/processing-request.repository';

export interface OutboxWriter {
  /**
   * Record an event to publish. Written in the caller's transaction, so the
   * event and the state change it announces commit or fail together.
   */
  add(
    queue: string,
    pattern: string,
    payload: Record<string, unknown>,
  ): Promise<void>;
}

export interface TransactionContext {
  requests: ProcessingRequestRepository;
  outbox: OutboxWriter;
}

/**
 * Runs a piece of work with a repository and an outbox bound to one
 * transaction.
 *
 * The repository arrives **through the context**, not by injection. That is
 * what makes the guarantee real: inside the callback the only reachable
 * repository is the transactional one, so a write cannot accidentally escape
 * the transaction.
 */
export interface UnitOfWork {
  runInTransaction<T>(
    work: (ctx: TransactionContext) => Promise<T>,
  ): Promise<T>;
}

export const UNIT_OF_WORK = 'UnitOfWork';
