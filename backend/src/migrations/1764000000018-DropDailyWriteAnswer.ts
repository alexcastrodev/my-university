import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropDailyWriteAnswer1764000000018 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "daily_write_answer"`);
  }

  async down(): Promise<void> {
    // The daily session was removed; the table is not recreated.
  }
}
