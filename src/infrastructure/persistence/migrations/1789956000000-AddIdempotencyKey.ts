import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIdempotencyKey1789956000000 implements MigrationInterface {
  name = 'AddIdempotencyKey1789956000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Nullable: rows created before S6 have no key and keep NULL.
    await queryRunner.query(`
      ALTER TABLE processing_request
        ADD COLUMN IF NOT EXISTS idempotency_key text NULL
    `);
    // The index, not a read before the insert, is what keeps two concurrent
    // confirmations from both creating a request. PostgreSQL never treats two
    // NULLs as equal here, so pre-S6 rows never collide.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_processing_request_owner_idempotency
        ON processing_request (owner_user_id, idempotency_key)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS uq_processing_request_owner_idempotency`,
    );
    await queryRunner.query(
      `ALTER TABLE processing_request DROP COLUMN IF EXISTS idempotency_key`,
    );
  }
}
