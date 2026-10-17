import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reply notifications: one row per person a reply was addressed to, plus the opt-out on the user
 * (on by default). Deleting the reply or the recipient removes the notification with it.
 */
export class AddNotifications1764000000017 implements MigrationInterface {
  name = 'AddNotifications1764000000017';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "notifyReplies" boolean NOT NULL DEFAULT true`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notification" (
        "id" SERIAL PRIMARY KEY,
        "userId" integer NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "commentId" integer NOT NULL REFERENCES "discussion_comment"("id") ON DELETE CASCADE,
        "markerId" integer NOT NULL REFERENCES "discussion_marker"("id") ON DELETE CASCADE,
        "readAt" timestamp,
        "createdAt" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_notification_user" ON "notification" ("userId", "createdAt" DESC)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "notification"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN IF EXISTS "notifyReplies"`);
  }
}
