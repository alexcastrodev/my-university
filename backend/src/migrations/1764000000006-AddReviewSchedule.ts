import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReviewSchedule1764000000006 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "review_schedule" (
        "id" SERIAL NOT NULL,
        "userId" integer NOT NULL,
        "sourceType" character varying NOT NULL,
        "sourceId" character varying NOT NULL,
        "easeFactor" double precision NOT NULL DEFAULT 2.5,
        "intervalDays" integer NOT NULL DEFAULT 0,
        "repetitions" integer NOT NULL DEFAULT 0,
        "dueAt" TIMESTAMP NOT NULL,
        "lastReviewedAt" TIMESTAMP,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_review_schedule_scope" UNIQUE ("userId", "sourceType", "sourceId"),
        CONSTRAINT "PK_review_schedule_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "review_schedule"
      ADD CONSTRAINT "FK_review_schedule_user"
      FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_review_schedule_due" ON "review_schedule" ("userId", "dueAt")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "review_schedule"`);
  }
}
