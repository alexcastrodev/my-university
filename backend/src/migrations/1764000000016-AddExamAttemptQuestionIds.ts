import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The questions the server served for an attempt. Grading and XP use this list instead of the ids
 * the client reports back, so a reader can no longer pick which questions count. Nullable: attempts
 * started before this column (or by a client that did not ask the server to serve) have none.
 */
export class AddExamAttemptQuestionIds1764000000016 implements MigrationInterface {
  name = 'AddExamAttemptQuestionIds1764000000016';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "exam_attempt" ADD COLUMN IF NOT EXISTS "questionIds" jsonb`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "exam_attempt" DROP COLUMN IF EXISTS "questionIds"`);
  }
}
