import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExamAttemptReview1764000000005 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "exam_attempt" ADD COLUMN IF NOT EXISTS "review" jsonb`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "exam_attempt" DROP COLUMN IF EXISTS "review"`);
  }
}
