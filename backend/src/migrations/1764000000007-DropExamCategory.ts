import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropExamCategory1764000000007 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "exam" DROP COLUMN IF EXISTS "category"`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "exam" ADD COLUMN IF NOT EXISTS "category" character varying NOT NULL DEFAULT 'Language'`,
    );
  }
}
