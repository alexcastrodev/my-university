import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A reader's private library of papers: one entry per user and paper, with reading status, an optional
 * rating, the day it was finished and the reader's own tags. Deleting the user or the paper removes the entry.
 */
export class AddPaperLibrary1764000000021 implements MigrationInterface {
  name = 'AddPaperLibrary1764000000021';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "paper_library_entry" (
        "id" SERIAL NOT NULL,
        "userId" integer NOT NULL,
        "paperId" integer NOT NULL,
        "status" character varying NOT NULL DEFAULT 'to-read',
        "rating" smallint,
        "tags" text array NOT NULL DEFAULT '{}',
        "completedAt" date,
        "addedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_paper_library_entry_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_paper_library_user_paper" UNIQUE ("userId", "paperId"),
        CONSTRAINT "CHK_paper_library_status" CHECK ("status" IN ('to-read', 'reading', 'read')),
        CONSTRAINT "CHK_paper_library_rating" CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 5),
        CONSTRAINT "CHK_paper_library_completed" CHECK ("completedAt" IS NULL OR "status" = 'read'),
        CONSTRAINT "FK_paper_library_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_paper_library_paper" FOREIGN KEY ("paperId") REFERENCES "paper"("id") ON DELETE CASCADE
      )
    `);
    // The library list filters one user's rows by status and sorts them by date.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_paper_library_user_status" ON "paper_library_entry" ("userId", "status", "addedAt" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_paper_library_tags" ON "paper_library_entry" USING GIN ("tags")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "paper_library_entry"`);
  }
}
