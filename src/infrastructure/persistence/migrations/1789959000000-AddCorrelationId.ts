import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCorrelationId1789959000000 implements MigrationInterface {
  name = 'AddCorrelationId1789959000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Nullable: legacy rows and requests created without an id keep flowing,
    // and their events simply omit the field. 128 matches the parser's bound
    // (L-005), so an oversized value is a 400 before it reaches storage.
    await queryRunner.query(`
      ALTER TABLE processing_request
        ADD COLUMN IF NOT EXISTS correlation_id varchar(128) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE processing_request DROP COLUMN IF EXISTS correlation_id`,
    );
  }
}
