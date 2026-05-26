import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLessonOrder1764000000003 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lesson" ADD COLUMN IF NOT EXISTS "order" integer NOT NULL DEFAULT 0`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lesson" DROP COLUMN IF EXISTS "order"`);
  }
}
