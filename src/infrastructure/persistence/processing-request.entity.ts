import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Kept separate from the domain aggregate so persistence annotations never
 * reach `src/domain`. The mapping between the two lives in the repository.
 */
@Entity({ name: 'processing_request' })
export class ProcessingRequestEntity {
  @PrimaryColumn({ name: 'processing_request_id', type: 'uuid' })
  processingRequestId: string;

  @Column({ name: 'owner_user_id', type: 'text' })
  ownerUserId: string;

  @Column({ name: 'source_storage_key', type: 'text' })
  sourceStorageKey: string;

  @Column({ name: 'status', type: 'text' })
  status: string;

  @Column({ name: 'attempt_id', type: 'uuid', nullable: true })
  attemptId: string | null;

  @Column({ name: 'zip_storage_key', type: 'text', nullable: true })
  zipStorageKey: string | null;

  @Column({ name: 'failure_code', type: 'text', nullable: true })
  failureCode: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
