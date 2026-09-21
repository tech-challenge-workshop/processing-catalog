import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * An event waiting to reach the broker.
 *
 * `published_at` being null is the definition of pending, and the partial
 * index on it is what keeps the relay's poll cheap as the table grows.
 */
@Entity({ name: 'outbox' })
export class OutboxEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'queue', type: 'text' })
  queue: string;

  @Column({ name: 'pattern', type: 'text' })
  pattern: string;

  @Column({ name: 'payload', type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;
}
