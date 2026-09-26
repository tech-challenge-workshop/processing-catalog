import { MigrationInterface, QueryRunner } from 'typeorm';

export class UniqueOwnerSource1789957000000 implements MigrationInterface {
  name = 'UniqueOwnerSource1789957000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // One upload is one request per owner, whatever key confirmed it. The
    // index, not the lookup before the insert, settles two concurrent
    // confirmations with different keys. The key plays no part, so a pre-S6
    // row with a NULL key still claims its source. A database that already
    // holds a duplicate fails here, naming the index, rather than merging.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_processing_request_owner_source
        ON processing_request (owner_user_id, source_storage_key)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS uq_processing_request_owner_source`,
    );
  }
}
