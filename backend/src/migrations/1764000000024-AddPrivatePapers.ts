import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Private papers (#203): a paper a reader keeps without it being in the public catalog. `ownerId` is null for
 * every paper that is public and the reader's user id for a private one; the row is deleted with its owner.
 *
 * Two readers may each keep a private paper with the same DOI or the same title, and a private paper must not
 * block the catalog from later holding that DOI, so the identity rules (one paper per DOI, one DOI-less paper
 * per fingerprint) now apply to public papers only.
 */
export class AddPrivatePapers1764000000024 implements MigrationInterface {
  name = 'AddPrivatePapers1764000000024';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "paper" ADD COLUMN IF NOT EXISTS "ownerId" integer REFERENCES "user"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_paper_owner" ON "paper" ("ownerId") WHERE "ownerId" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "paper" DROP CONSTRAINT IF EXISTS "UQ_paper_doi"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_paper_doi" ON "paper" ("doi") WHERE "ownerId" IS NULL`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_paper_fingerprint_without_doi"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_paper_fingerprint_without_doi" ON "paper" ("fingerprint") WHERE "doi" IS NULL AND "ownerId" IS NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // A private paper has no place in the old model, so it goes (its library entries and PDF go with it).
    await queryRunner.query(`DELETE FROM "paper" WHERE "ownerId" IS NOT NULL`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_paper_fingerprint_without_doi"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_paper_fingerprint_without_doi" ON "paper" ("fingerprint") WHERE "doi" IS NULL`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_paper_doi"`);
    await queryRunner.query(
      `ALTER TABLE "paper" ADD CONSTRAINT "UQ_paper_doi" UNIQUE ("doi")`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_paper_owner"`);
    await queryRunner.query(`ALTER TABLE "paper" DROP COLUMN IF EXISTS "ownerId"`);
  }
}
