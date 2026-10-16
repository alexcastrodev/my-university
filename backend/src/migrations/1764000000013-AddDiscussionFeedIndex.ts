import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The discussion feed aggregates the live comments of each marker (latest activity, counts, who
 * wrote them). This partial index holds every column that aggregation reads, so Postgres can
 * answer it with an index-only scan in marker order instead of reading the comment bodies.
 */
export class AddDiscussionFeedIndex1764000000013 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_discussion_comment_feed"
        ON "discussion_comment" ("markerId", "createdAt")
        INCLUDE ("parentId", "authorId", "acceptedReplyId")
        WHERE "deletedAt" IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_discussion_comment_feed"`,
    );
  }
}
