import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Selective sharing of annotations (#187). A share is a copy kept apart from the private annotation, so the
 * private table needs no new column and nothing about it can leak through a join by accident. The share goes
 * when the annotation goes, and when the reader or a recipient goes.
 */
export class AddPaperAnnotationShares1764000000027 implements MigrationInterface {
  name = 'AddPaperAnnotationShares1764000000027';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "paper_annotation_share" (
        "id" uuid NOT NULL DEFAULT uuidv7(),
        "annotationId" uuid NOT NULL REFERENCES "paper_annotation"("id") ON DELETE CASCADE,
        "paperSlug" character varying(100) NOT NULL,
        "authorId" integer NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "visibility" character varying(8) NOT NULL,
        "kind" character varying(16) NOT NULL,
        "body" text,
        "page" integer,
        "quote" text,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_paper_annotation_share" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_paper_annotation_share_annotation" UNIQUE ("annotationId"),
        CONSTRAINT "CHK_paper_annotation_share_visibility" CHECK ("visibility" IN ('public', 'users')),
        CONSTRAINT "CHK_paper_annotation_share_kind" CHECK ("kind" IN ('note', 'highlight', 'comment', 'question'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_paper_annotation_share_paper" ON "paper_annotation_share" ("paperSlug", "visibility")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_paper_annotation_share_author" ON "paper_annotation_share" ("authorId")`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "paper_annotation_share_recipient" (
        "shareId" uuid NOT NULL REFERENCES "paper_annotation_share"("id") ON DELETE CASCADE,
        "userId" integer NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        CONSTRAINT "PK_paper_annotation_share_recipient" PRIMARY KEY ("shareId", "userId")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_paper_annotation_share_recipient_user" ON "paper_annotation_share_recipient" ("userId")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "paper_annotation_share_recipient"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "paper_annotation_share"`);
  }
}
