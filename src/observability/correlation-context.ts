import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

interface CorrelationScope {
  correlationId: string;
}

const PRINTABLE_ASCII = /^[\x20-\x7E]{1,128}$/;

export function parseCorrelationId(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return PRINTABLE_ASCII.test(trimmed) ? trimmed : null;
}

export class CorrelationContext {
  private readonly storage = new AsyncLocalStorage<CorrelationScope>();

  runWithCorrelation<T>(id: string, fn: () => T): T {
    return this.storage.run({ correlationId: id }, fn);
  }

  getCorrelationId(): string | undefined {
    return this.storage.getStore()?.correlationId;
  }

  getOrGenerateCorrelationId(): string {
    return parseCorrelationId(this.getCorrelationId()) ?? randomUUID();
  }
}

/**
 * The one process-wide context: injected consumers (middleware) and direct
 * importers (services, the pino mixin) must share the same ALS store, so the
 * id the edge assigns is the id everything else reads.
 */
export const correlationContext = new CorrelationContext();
