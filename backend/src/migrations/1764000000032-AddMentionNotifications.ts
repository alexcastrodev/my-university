import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mentions become a second kind of notification in the same table. `kind` says whether the comment
 * replied to the reader or mentioned them; every existing row is a reply.
 *
 * One notification per reader per comment, whatever the kind: the unique index is what keeps a reply
 * that also mentions its addressee, or an edit that repeats a mention, from notifying twice. Reply
 * notifications are inserted once per comment with distinct readers, so existing rows already obey it;
 * the DELETE only guards a database that somehow does not.
 */
export class AddMentionNotifications1764000000032 implements MigrationInterface {
  name = 'AddMentionNotifications1764000000032';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notification" ADD COLUMN IF NOT EXISTS "kind" character varying(8) NOT NULL DEFAULT 'reply'`,
    );
    await queryRunner.query(`ALTER TABLE "notification" DROP CONSTRAINT IF EXISTS "CHK_notification_kind"`);
    await queryRunner.query(
      `ALTER TABLE "notification" ADD CONSTRAINT "CHK_notification_kind" CHECK ("kind" IN ('reply', 'mention'))`,
    );
    await queryRunner.query(`
      DELETE FROM "notification" a
       USING "notification" b
       WHERE a."userId" = b."userId" AND a."commentId" = b."commentId" AND a."id" > b."id"
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_notification_user_comment" ON "notification" ("userId", "commentId")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_notification_user_comment"`);
    await queryRunner.query(`ALTER TABLE "notification" DROP CONSTRAINT IF EXISTS "CHK_notification_kind"`);
    await queryRunner.query(`ALTER TABLE "notification" DROP COLUMN IF EXISTS "kind"`);
  }
}
