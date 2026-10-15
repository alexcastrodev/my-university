import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropReviewSchedule1764000000012 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "review_schedule"`);
  }

  async down(): Promise<void> {
    // The review feature was removed; the table is not recreated.
  }
}
