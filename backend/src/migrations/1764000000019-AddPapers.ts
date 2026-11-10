import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPapers1764000000019 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "paper" (
        "id" SERIAL NOT NULL,
        "title" text NOT NULL,
        "abstract" text,
        "doi" text,
        "fingerprint" text NOT NULL,
        "venue" text,
        "publicationDate" character varying(10),
        "url" text,
        "researchArea" text,
        "type" character varying NOT NULL DEFAULT 'other',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_paper_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_paper_doi" UNIQUE ("doi"),
        CONSTRAINT "CHK_paper_doi" CHECK ("doi" IS NULL OR "doi" ~ '^10\\.[0-9]{4,9}/[^[:space:]]+$' AND "doi" = lower("doi")),
        CONSTRAINT "CHK_paper_date" CHECK ("publicationDate" IS NULL OR "publicationDate" ~ '^[0-9]{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12][0-9]|3[01]))?)?$'),
        CONSTRAINT "CHK_paper_type" CHECK ("type" IN ('journal-article', 'conference-paper', 'preprint', 'book-chapter', 'book', 'thesis', 'report', 'other'))
      )
    `);
    // A paper without a DOI is identified by its fingerprint, so two of them may not share it.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_paper_fingerprint_without_doi" ON "paper" ("fingerprint") WHERE "doi" IS NULL
    `);
    // The lookup for a paper that has a DOI looks for a DOI-less record with the same fingerprint.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_paper_fingerprint" ON "paper" ("fingerprint")
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "paper_author" (
        "id" SERIAL NOT NULL,
        "paperId" integer NOT NULL,
        "position" integer NOT NULL,
        "name" text NOT NULL,
        "orcid" character varying(19),
        CONSTRAINT "PK_paper_author_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_paper_author_position" UNIQUE ("paperId", "position"),
        CONSTRAINT "FK_paper_author_paper" FOREIGN KEY ("paperId")
          REFERENCES "paper"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "paper_keyword" (
        "id" SERIAL NOT NULL,
        "paperId" integer NOT NULL,
        "keyword" text NOT NULL,
        CONSTRAINT "PK_paper_keyword_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_paper_keyword" UNIQUE ("paperId", "keyword"),
        CONSTRAINT "FK_paper_keyword_paper" FOREIGN KEY ("paperId")
          REFERENCES "paper"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_paper_keyword_keyword" ON "paper_keyword" ("keyword")
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "paper_source" (
        "id" SERIAL NOT NULL,
        "paperId" integer NOT NULL,
        "source" character varying NOT NULL,
        "externalId" character varying,
        "payload" jsonb NOT NULL,
        "conflicts" jsonb NOT NULL DEFAULT '[]',
        "retrievedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_paper_source_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_paper_source_paper" FOREIGN KEY ("paperId")
          REFERENCES "paper"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_paper_source_paper" ON "paper_source" ("paperId")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "paper_source"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "paper_keyword"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "paper_author"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "paper"`);
  }
}
