import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The public papers become authored files (#213), like the concepts: `seed/data/papers/papers.json` and
 * `content/<slug>/{en,pt-BR}.md`. Nothing in the database is a public paper any more, so:
 *
 * - A library entry and a PDF point at a public paper by `paperSlug` and at a private one by `paperId`, exactly
 *   one of the two.
 * - The public rows readers created are discarded, with the library entries, PDFs and discussions that pointed
 *   at them (product owner decision). A private paper, its PDF and its entry are untouched.
 * - The Research Analysis tables and the staff roles that only served the curator workflow go.
 * - `paper.ownerId` becomes required: every row left is a reader's own paper.
 */
export class PublicPapersAreFiles1764000000025 implements MigrationInterface {
  name = 'PublicPapersAreFiles1764000000025';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, owner] of [
      ['paper_library_entry', 'userId'],
      ['paper_attachment', 'ownerId'],
    ] as const) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "paperId" DROP NOT NULL`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "paperSlug" character varying(120)`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "CHK_${table}_one_paper" CHECK (("paperId" IS NULL) <> ("paperSlug" IS NULL))`,
      );
    }
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_paper_library_user_slug" ON "paper_library_entry" ("userId", "paperSlug")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_paper_attachment_slug_owner" ON "paper_attachment" ("paperSlug", "ownerId")`,
    );

    // The boards of the discarded papers were keyed by their UUIDv7; a paper's board is now keyed by its slug.
    // The comments, votes and notifications go by cascade.
    await queryRunner.query(
      `DELETE FROM "discussion_marker" WHERE "topicKey" ~ '^paper:[0-9a-f]{8}-[0-9a-f]{4}-'`,
    );
    // Authors, keywords, sources, analyses, library entries and PDFs go by cascade; the trigger of the PDFs
    // queues their stored objects for deletion.
    await queryRunner.query(`DELETE FROM "paper" WHERE "ownerId" IS NULL`);

    await queryRunner.query(`DROP TABLE IF EXISTS "paper_analysis_event"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "paper_analysis"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN IF EXISTS "roles"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_paper_doi"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_paper_fingerprint_without_doi"`,
    );
    await queryRunner.query(
      `ALTER TABLE "paper" ALTER COLUMN "ownerId" SET NOT NULL`,
    );
  }

  async down(): Promise<void> {
    throw new Error(
      'Irreversible: the public papers, their analyses and the staff roles were discarded. Restore from a backup taken before this migration.',
    );
  }
}
