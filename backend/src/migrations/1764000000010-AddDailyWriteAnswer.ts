import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDailyWriteAnswer1764000000010 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "daily_write_answer" (
        "id" SERIAL NOT NULL,
        "userId" integer NOT NULL,
        "sourceId" character varying NOT NULL,
        "text" text NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_daily_write_answer_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "daily_write_answer"
      ADD CONSTRAINT "FK_daily_write_answer_user"
      FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_daily_write_answer_user_source" ON "daily_write_answer" ("userId", "sourceId")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "daily_write_answer"`);
  }
}
