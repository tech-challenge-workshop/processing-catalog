import { MigrationInterface, QueryRunner } from 'typeorm';

export class IndexProcessingRequestOwnerCreatedAt1789955000000 implements MigrationInterface {
  name = 'IndexProcessingRequestOwnerCreatedAt1789955000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Matches the owner-scoped page exactly: filter by owner, newest first,
    // id as the tiebreak. It also serves the owner count, so the owner-only
    // index it replaces would be dead weight on every write.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_processing_request_owner_created
        ON processing_request (owner_user_id, created_at DESC, processing_request_id)
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_processing_request_owner`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_processing_request_owner
        ON processing_request (owner_user_id)
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_processing_request_owner_created`,
    );
  }
}
