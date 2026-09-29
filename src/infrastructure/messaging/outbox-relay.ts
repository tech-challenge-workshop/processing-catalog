import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { catalogMetrics } from '../../observability/metrics';
import { RabbitMQConnection } from '../rabbitmq/rabbitmq.connection';

export interface PendingOutboxRow {
  id: string;
  queue: string;
  pattern: string;
  payload: Record<string, unknown>;
  created_at: Date;
}

/**
 * Key of the transaction-scoped advisory lock that lets one relay drain at a
 * time across every Catalog replica. It is the first 8 bytes of
 * sha256('catalog.outbox-relay') read as a signed bigint, so it is stable and
 * unlikely to collide; nothing else in the schema takes advisory locks.
 *
 * Holding the lock for the whole drain keeps the global `ORDER BY id`, so a
 * request's events reach the broker in the order they were recorded, exactly
 * as with one replica. The cost: the transaction stays open while publishing,
 * up to one publish timeout per row, but it holds only the lock and the row
 * marks, and a drain stops at its first failure.
 */
export const OUTBOX_RELAY_LOCK_KEY = '-3576818703360397482';

/**
 * The only thing that talks to the broker.
 *
 * Publishes pending rows and marks them sent **after** the broker confirms.
 * Marking first would turn a broker failure into a silently dropped event,
 * which is the loss this slice exists to remove.
 *
 * Delivery is therefore at-least-once: a crash between the confirm and the
 * commit republishes the row. Every consumer already deduplicates by eventId,
 * so a repeat is absorbed, and losing an event is the worse failure.
 */
@Injectable()
export class OutboxRelay implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly connection: RabbitMQConnection,
  ) {}

  /**
   * Feeds the outbox gauges from this relay's own pending queries on every
   * scrape. Done at module init rather than construction, so only the app's
   * relay registers - not every instance a test builds.
   */
  onModuleInit(): void {
    catalogMetrics.setOutboxSource(this);
  }

  /**
   * Publishes pending rows. Returns how many reached the broker, or 0 when
   * another replica is draining.
   *
   * On the first failed publish (a refusal or a confirm timeout) it stops,
   * commits the marks made so far, and then rethrows, so confirmed rows are
   * not republished and the failed row stays pending for the next tick.
   */
  async drain(batchSize = 50): Promise<number> {
    let failed = false;
    let failure: unknown;
    const published = await this.dataSource.transaction(async (manager) => {
      const [{ locked }]: { locked: boolean }[] = await manager.query(
        `SELECT pg_try_advisory_xact_lock($1) AS locked`,
        [OUTBOX_RELAY_LOCK_KEY],
      );
      if (!locked) {
        return 0;
      }

      const rows: PendingOutboxRow[] = await manager.query(
        `SELECT id, queue, pattern, payload, created_at
           FROM outbox
          WHERE published_at IS NULL
          ORDER BY id
          LIMIT $1`,
        [batchSize],
      );

      let sent = 0;
      for (const row of rows) {
        // Stop at the first failure rather than skipping ahead: events for one
        // request must reach the broker in the order they were recorded.
        try {
          await this.connection.sendToQueue(
            row.queue,
            row.pattern,
            row.payload,
          );
        } catch (error) {
          // A refusal or a confirm timeout: the row stays pending for the
          // next tick. Counted here, once per failed attempt - the drain
          // stops at this row, so a tick never counts twice.
          catalogMetrics.recordOutboxPublishFailure();
          failed = true;
          failure = error;
          break;
        }
        await manager.query(
          `UPDATE outbox SET published_at = now() WHERE id = $1`,
          [row.id],
        );
        sent += 1;
      }
      return sent;
    });

    if (failed) {
      throw failure;
    }
    return published;
  }

  async pendingCount(): Promise<number> {
    const rows: { n: number }[] = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM outbox WHERE published_at IS NULL`,
    );
    return rows[0].n;
  }

  /** Seconds since the oldest pending row was recorded, or null when empty. */
  async oldestPendingAgeSeconds(): Promise<number | null> {
    const rows: { age: number | null }[] = await this.dataSource.query(
      `SELECT EXTRACT(EPOCH FROM (now() - min(created_at)))::int AS age
         FROM outbox WHERE published_at IS NULL`,
    );
    return rows[0]?.age ?? null;
  }
}
