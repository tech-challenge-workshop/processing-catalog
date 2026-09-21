import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * One row per event already applied.
 *
 * `event_id` is the primary key, which is what makes deduplication a schema
 * guarantee rather than an application convention: two replicas racing the
 * same event produce one row and one rejection.
 */
@Entity({ name: 'processed_event' })
export class ProcessedEventEntity {
  @PrimaryColumn({ name: 'event_id', type: 'uuid' })
  eventId: string;

  @Column({ name: 'processing_request_id', type: 'uuid', nullable: true })
  processingRequestId: string | null;

  @Column({ name: 'processed_at', type: 'timestamptz' })
  processedAt: Date;
}
