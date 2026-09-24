import { ProcessingRequestDomainError } from '../../domain/processing-request';

export const DEFAULT_RETRY_BACKOFF_MS = 1000;

export function retryBackoffMs(): number {
  const configured = Number(process.env.RABBITMQ_RETRY_BACKOFF_MS);
  return Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_RETRY_BACKOFF_MS;
}

/**
 * A failure no retry can fix: the message itself is wrong. A domain rule it
 * breaks, or a body that is not JSON, fails identically on every delivery.
 */
export function isPermanentFailure(error: unknown): boolean {
  return (
    error instanceof ProcessingRequestDomainError ||
    error instanceof SyntaxError
  );
}

interface NackingChannel {
  nack(message: unknown, allUpTo?: boolean, requeue?: boolean): void;
}

/**
 * Settles a message whose handling threw.
 *
 * Permanent failures are rejected without requeue, which the broker's
 * dead-letter policy routes to `<queue>.dlq`.
 *
 * Anything else is presumed transient - the database or the broker briefly
 * away - and requeued, but only after a pause. RabbitMQ 4 does not count an
 * explicit requeue against a quorum queue's delivery limit, so the limit
 * cannot bound this loop; the pause is what keeps it from spinning while the
 * dependency is down. Retrying indefinitely is deliberate: a transient outage
 * must not dead-letter every message that happened to be in flight.
 */
export async function settleFailedMessage(
  channel: NackingChannel,
  message: unknown,
  error: unknown,
  backoffMs: number = retryBackoffMs(),
): Promise<void> {
  if (isPermanentFailure(error)) {
    channel.nack(message, false, false);
    return;
  }
  if (backoffMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }
  channel.nack(message, false, true);
}
