import { randomUUID } from 'node:crypto';
import {
  correlationContext,
  parseCorrelationId,
} from '../../observability/correlation-context';

/**
 * The message's own `correlationId`, flat or inside a Nest `{pattern, data}`
 * envelope, or null when it has none or it is invalid. A body that is not
 * JSON also yields null: the handler rejects it, not this lookup.
 */
function correlationIdOf(content: string): string | null {
  let body: unknown;
  try {
    body = JSON.parse(content);
  } catch {
    return null;
  }
  if (body && typeof body === 'object' && 'data' in body) {
    body = body.data;
  }
  if (!body || typeof body !== 'object') {
    return null;
  }
  // Strict parse (L-010): a non-string is replaced, never String()-coerced.
  return parseCorrelationId((body as Record<string, unknown>).correlationId);
}

/**
 * Runs a consumer's handling inside the message's correlation scope, so every
 * log line it emits carries the pipeline id. A missing or invalid id gets a
 * fresh one and never fails the message. The scope ends when `handle`
 * settles, success or failure.
 */
export function withMessageCorrelation<T>(
  content: string,
  handle: () => Promise<T>,
): Promise<T> {
  const id = correlationIdOf(content) ?? randomUUID();
  return correlationContext.runWithCorrelation(id, handle);
}
