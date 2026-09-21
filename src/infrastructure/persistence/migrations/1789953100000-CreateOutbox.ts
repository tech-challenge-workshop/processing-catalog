import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOutbox1789953100000 implements MigrationInterface {
  name = 'CreateOutbox1789953100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS outbox (
        id            bigserial   PRIMARY KEY,
        queue         text        NOT NULL,
        pattern       text        NOT NULL,
        payload       jsonb       NOT NULL,
        created_at    timestamptz NOT NULL,
        published_at  timestamptz NULL
      )
    `);

    // Partial: the relay only ever asks for pending rows, and this keeps that
    // question cheap however large the table grows.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_outbox_pending
        ON outbox (id) WHERE published_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_outbox_pending`);
    await queryRunner.query(`DROP TABLE IF EXISTS outbox`);
  }
}
