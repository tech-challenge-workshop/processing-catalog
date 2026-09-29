import { ProcessingRequestDomainError } from '../../domain/processing-request';
import {
  catalogMetrics,
  type ConsumedEventName,
} from '../../observability/metrics';

export const DEFAULT_RETRY_BACKOFF_MS = 1000;

/**
 * Reads a non-negative millisecond setting. Unset, empty or whitespace-only
 * means the default: `Number('')` is 0, so without the blank check an empty
 * variable would silently become zero. `0` is an explicit, valid value;
 * negative or non-numeric values fall back to the default.
 */
export function parseNonNegativeMs(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const configured = Number(raw);
  return Number.isFinite(configured) && configured >= 0 ? configured : fallback;
}

export function retryBackoffMs(): number {
  return parseNonNegativeMs(
    process.env.RABBITMQ_RETRY_BACKOFF_MS,
    DEFAULT_RETRY_BACKOFF_MS,
  );
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

interface SettlingChannel extends NackingChannel {
  ack(message: unknown): void;
}

/**
 * The single settlement path for a consumed message: runs the handler, acks
 * on success, and otherwise settles through `settleFailedMessage`.
 *
 * Counts `fiapx_events_consumed_total` exactly where the outcome is decided,
 * so no consumer can forget it. Only final settlements count - acked or
 * dead-lettered. A requeue is not one: the redelivery is counted when it
 * settles. The event name comes from the consumer, which knows its pattern.
 */
export async function settleMessage(
  channel: SettlingChannel,
  message: unknown,
  event: ConsumedEventName,
  handle: () => Promise<void>,
  backoffMs: number = retryBackoffMs(),
): Promise<void> {
  try {
    await handle();
  } catch (error) {
    await settleFailedMessage(channel, message, error, backoffMs);
    if (isPermanentFailure(error)) {
      catalogMetrics.recordEventConsumed(event, 'dead_lettered');
    }
    return;
  }
  channel.ack(message);
  catalogMetrics.recordEventConsumed(event, 'acked');
}
