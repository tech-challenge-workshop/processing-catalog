import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOwnerEmail1789958000000 implements MigrationInterface {
  name = 'AddOwnerEmail1789958000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // NOT NULL, no default: this is a local-dev system with no rows to
    // preserve across the schema change (see design.md's Tech Decisions).
    await queryRunner.query(`
      ALTER TABLE processing_request
        ADD COLUMN IF NOT EXISTS owner_email text NOT NULL DEFAULT ''
    `);
    await queryRunner.query(`
      ALTER TABLE processing_request ALTER COLUMN owner_email DROP DEFAULT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE processing_request DROP COLUMN IF EXISTS owner_email`,
    );
  }
}
