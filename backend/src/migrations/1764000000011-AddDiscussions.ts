import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDiscussions1764000000011 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "discussion_marker" (
        "id" SERIAL NOT NULL,
        "topicKey" character varying NOT NULL,
        "lang" character varying NOT NULL,
        "anchorKey" character varying NOT NULL,
        "blockIndex" integer NOT NULL,
        "quote" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_discussion_marker_anchor" UNIQUE ("topicKey", "lang", "anchorKey", "blockIndex"),
        CONSTRAINT "PK_discussion_marker_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "discussion_comment" (
        "id" SERIAL NOT NULL,
        "markerId" integer NOT NULL,
        "parentId" integer,
        "authorId" integer,
        "body" text NOT NULL,
        "acceptedReplyId" integer,
        "deletedAt" TIMESTAMP,
        "editedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_discussion_comment_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_discussion_comment_marker" FOREIGN KEY ("markerId")
          REFERENCES "discussion_marker"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_discussion_comment_parent" FOREIGN KEY ("parentId")
          REFERENCES "discussion_comment"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_discussion_comment_author" FOREIGN KEY ("authorId")
          REFERENCES "user"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_discussion_comment_marker" ON "discussion_comment" ("markerId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_discussion_comment_author" ON "discussion_comment" ("authorId", "createdAt")
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "discussion_vote" (
        "id" SERIAL NOT NULL,
        "commentId" integer NOT NULL,
        "userId" integer NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_discussion_vote_scope" UNIQUE ("commentId", "userId"),
        CONSTRAINT "PK_discussion_vote_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_discussion_vote_comment" FOREIGN KEY ("commentId")
          REFERENCES "discussion_comment"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_discussion_vote_user" FOREIGN KEY ("userId")
          REFERENCES "user"("id") ON DELETE CASCADE
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "discussion_vote"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "discussion_comment"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "discussion_marker"`);
  }
}
