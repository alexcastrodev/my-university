import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLessonTopic1764000000002 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lesson" ADD COLUMN IF NOT EXISTS "topic" character varying`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lesson" DROP COLUMN IF EXISTS "topic"`);
  }
}
