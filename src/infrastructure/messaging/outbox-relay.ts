import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RabbitMQConnection } from '../rabbitmq/rabbitmq.connection';

export interface PendingOutboxRow {
  id: string;
  queue: string;
  pattern: string;
  payload: Record<string, unknown>;
  created_at: Date;
}

/**
 * The only thing that talks to the broker.
 *
 * Publishes pending rows and marks them sent **after** the broker confirms.
 * Marking first would turn a broker failure into a silently dropped event,
 * which is the loss this slice exists to remove.
 *
 * Delivery is therefore at-least-once: a crash between the confirm and the
 * mark republishes the row. Every consumer already deduplicates by eventId,
 * so a repeat is absorbed, and losing an event is the worse failure.
 */
@Injectable()
export class OutboxRelay {
  constructor(
    private readonly dataSource: DataSource,
    private readonly connection: RabbitMQConnection,
  ) {}

  /** Publishes every pending row. Returns how many reached the broker. */
  async drain(batchSize = 50): Promise<number> {
    const rows: PendingOutboxRow[] = await this.dataSource.query(
      `SELECT id, queue, pattern, payload, created_at
         FROM outbox
        WHERE published_at IS NULL
        ORDER BY id
        LIMIT $1`,
      [batchSize],
    );

    let published = 0;
    for (const row of rows) {
      // Stop at the first failure rather than skipping ahead: events for one
      // request must reach the broker in the order they were recorded.
      await this.connection.sendToQueue(row.queue, row.pattern, row.payload);
      await this.dataSource.query(
        `UPDATE outbox SET published_at = now() WHERE id = $1`,
        [row.id],
      );
      published += 1;
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
