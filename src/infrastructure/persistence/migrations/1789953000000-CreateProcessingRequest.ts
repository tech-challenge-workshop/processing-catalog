import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProcessingRequest1789953000000 implements MigrationInterface {
  name = 'CreateProcessingRequest1789953000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS processing_request (
        processing_request_id uuid        PRIMARY KEY,
        owner_user_id         text        NOT NULL,
        source_storage_key    text        NOT NULL,
        status                text        NOT NULL,
        attempt_id            uuid        NULL,
        zip_storage_key       text        NULL,
        failure_code          text        NULL,
        created_at            timestamptz NOT NULL,
        updated_at            timestamptz NOT NULL
      )
    `);

    // event_id as the primary key is the deduplication guarantee: two
    // replicas racing the same event produce one row and one rejection.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS processed_event (
        event_id              text        PRIMARY KEY,
        processing_request_id uuid        NULL,
        processed_at          timestamptz NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_processing_request_owner
        ON processing_request (owner_user_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_processing_request_owner`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS processed_event`);
    await queryRunner.query(`DROP TABLE IF EXISTS processing_request`);
  }
}
