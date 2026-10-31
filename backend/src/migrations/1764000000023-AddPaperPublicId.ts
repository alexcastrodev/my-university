import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Papers get an opaque, time-ordered public id (#202). The integer `id` stays the internal key, so no
 * foreign key changes; only what addresses a paper from outside (URLs, the API, the discussion topic) moves
 * to `publicId`.
 *
 * `uuidv7()` is native to PostgreSQL 18. A volatile default is evaluated for every existing row when the
 * column is added, so each paper that already exists gets its own id in the same statement. The default
 * stays, so a paper inserted without one (an import, a seed) gets one too.
 *
 * Discussion topics are keyed `paper:<id>`. The keys are rewritten in place to `paper:<publicId>`, so the
 * threads of an existing paper stay attached to it.
 */
export class AddPaperPublicId1764000000023 implements MigrationInterface {
  name = 'AddPaperPublicId1764000000023';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "paper" ADD COLUMN IF NOT EXISTS "publicId" uuid NOT NULL DEFAULT uuidv7()`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_paper_publicId" ON "paper" ("publicId")`,
    );
    await queryRunner.query(`
      UPDATE "discussion_marker" m
         SET "topicKey" = 'paper:' || p."publicId"
        FROM "paper" p
       WHERE m."topicKey" = 'paper:' || p."id"
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "discussion_marker" m
         SET "topicKey" = 'paper:' || p."id"
        FROM "paper" p
       WHERE m."topicKey" = 'paper:' || p."publicId"
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_paper_publicId"`);
    await queryRunner.query(`ALTER TABLE "paper" DROP COLUMN IF EXISTS "publicId"`);
  }
}
