import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaperAnalysis1764000000020 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "roles" text[] NOT NULL DEFAULT '{}'
    `);
    // One row per revision of a paper's analysis. Published rows are never edited: a change is a new draft.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "paper_analysis" (
        "id" SERIAL NOT NULL,
        "paperId" integer NOT NULL,
        "revision" integer NOT NULL,
        "status" character varying NOT NULL,
        "sections" jsonb NOT NULL DEFAULT '{}',
        "authorId" integer,
        "publishedById" integer,
        "publishedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_paper_analysis_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_paper_analysis_revision" UNIQUE ("paperId", "revision"),
        CONSTRAINT "CHK_paper_analysis_status" CHECK ("status" IN ('draft', 'published', 'superseded', 'withdrawn')),
        CONSTRAINT "FK_paper_analysis_paper" FOREIGN KEY ("paperId")
          REFERENCES "paper"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_paper_analysis_author" FOREIGN KEY ("authorId")
          REFERENCES "user"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_paper_analysis_publisher" FOREIGN KEY ("publishedById")
          REFERENCES "user"("id") ON DELETE SET NULL
      )
    `);
    // A paper has at most one current draft and one current published analysis.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_paper_analysis_one_draft"
        ON "paper_analysis" ("paperId") WHERE "status" = 'draft'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_paper_analysis_one_published"
        ON "paper_analysis" ("paperId") WHERE "status" = 'published'
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "paper_analysis_event" (
        "id" SERIAL NOT NULL,
        "analysisId" integer NOT NULL,
        "action" character varying NOT NULL,
        "actorId" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_paper_analysis_event_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_paper_analysis_event_action" CHECK ("action" IN ('draft_created', 'draft_edited', 'published', 'withdrawn')),
        CONSTRAINT "FK_paper_analysis_event_analysis" FOREIGN KEY ("analysisId")
          REFERENCES "paper_analysis"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_paper_analysis_event_actor" FOREIGN KEY ("actorId")
          REFERENCES "user"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_paper_analysis_event_analysis" ON "paper_analysis_event" ("analysisId")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "paper_analysis_event"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "paper_analysis"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN IF EXISTS "roles"`);
  }
}
