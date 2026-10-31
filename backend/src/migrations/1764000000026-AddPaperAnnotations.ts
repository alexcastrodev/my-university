import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Notes and annotations of a reader's library entry (#186). They go with the entry (a removed paper takes its
 * notes with it, and the reader is asked first). The checks keep the shapes apart: a note has text and no
 * place in the PDF, and everything else is anchored to a page of a PDF identified by its hash.
 */
export class AddPaperAnnotations1764000000026 implements MigrationInterface {
  name = 'AddPaperAnnotations1764000000026';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "paper_annotation" (
        "id" uuid NOT NULL DEFAULT uuidv7(),
        "entryId" integer NOT NULL REFERENCES "paper_library_entry"("id") ON DELETE CASCADE,
        "kind" character varying(16) NOT NULL,
        "body" text,
        "pdfVersion" integer,
        "pdfSha256" character(64),
        "page" integer,
        "quote" text,
        "prefix" character varying(200),
        "suffix" character varying(200),
        "rects" jsonb,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_paper_annotation" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_paper_annotation_kind" CHECK ("kind" IN ('note', 'highlight', 'comment', 'question', 'bookmark')),
        CONSTRAINT "CHK_paper_annotation_shape" CHECK (
          ("kind" = 'note' AND "body" IS NOT NULL AND "page" IS NULL AND "pdfSha256" IS NULL)
          OR ("kind" <> 'note' AND "page" IS NOT NULL AND "page" >= 1 AND "pdfSha256" IS NOT NULL AND "pdfVersion" IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_paper_annotation_entry" ON "paper_annotation" ("entryId", "createdAt")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "paper_annotation"`);
  }
}
