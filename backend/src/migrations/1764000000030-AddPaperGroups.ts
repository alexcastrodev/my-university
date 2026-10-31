import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reading groups (#190): a few readers who study a set of public papers together. A group has an owner, members
 * with a role (`owner`, `moderator`, `member`), invitations that stay pending until the invitee answers, a list
 * of public papers, a flat board of posts, and the annotations members chose to share into it.
 *
 * A group holds public papers by slug and nothing of anyone's library: a member's private papers, notes and PDFs
 * are never reachable through it. An annotation is shared into a group as the same kind of copy as in #187, with
 * the groups it is for in `paper_annotation_share_group`. Everything cascades from the group, the member and the
 * share, so leaving, being removed or deleting the account takes the access (and what the person put there) away.
 * The tables are read and written with SQL, so there is no entity for them.
 */
export class AddPaperGroups1764000000030 implements MigrationInterface {
  name = 'AddPaperGroups1764000000030';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "paper_group" (
        "id" uuid NOT NULL DEFAULT uuidv7(),
        "ownerId" integer NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "name" character varying(80) NOT NULL,
        "description" character varying(500),
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_paper_group" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_paper_group_name" CHECK (length(btrim("name")) > 0)
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_paper_group_owner" ON "paper_group" ("ownerId")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "paper_group_member" (
        "groupId" uuid NOT NULL REFERENCES "paper_group"("id") ON DELETE CASCADE,
        "userId" integer NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "role" character varying(10) NOT NULL,
        "joinedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_paper_group_member" PRIMARY KEY ("groupId", "userId"),
        CONSTRAINT "CHK_paper_group_member_role" CHECK ("role" IN ('owner', 'moderator', 'member'))
      )
    `);
    // Exactly one owner, whatever the code does.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_paper_group_one_owner" ON "paper_group_member" ("groupId") WHERE "role" = 'owner'`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_paper_group_member_user" ON "paper_group_member" ("userId")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "paper_group_invitation" (
        "id" uuid NOT NULL DEFAULT uuidv7(),
        "groupId" uuid NOT NULL REFERENCES "paper_group"("id") ON DELETE CASCADE,
        "inviteeId" integer NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "invitedBy" integer REFERENCES "user"("id") ON DELETE SET NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_paper_group_invitation" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_paper_group_invitation" UNIQUE ("groupId", "inviteeId")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_paper_group_invitation_invitee" ON "paper_group_invitation" ("inviteeId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "paper_group_paper" (
        "groupId" uuid NOT NULL REFERENCES "paper_group"("id") ON DELETE CASCADE,
        "paperSlug" character varying(100) NOT NULL,
        "addedBy" integer REFERENCES "user"("id") ON DELETE SET NULL,
        "addedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_paper_group_paper" PRIMARY KEY ("groupId", "paperSlug")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "paper_group_post" (
        "id" uuid NOT NULL DEFAULT uuidv7(),
        "groupId" uuid NOT NULL REFERENCES "paper_group"("id") ON DELETE CASCADE,
        "authorId" integer NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "paperSlug" character varying(100),
        "body" text NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_paper_group_post" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_paper_group_post_body" CHECK (char_length("body") BETWEEN 1 AND 5000)
      )
    `);
    // The ids are time ordered (uuidv7), so the newest post of a group is the highest id.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_paper_group_post_group" ON "paper_group_post" ("groupId", "id" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_paper_group_post_author" ON "paper_group_post" ("authorId", "createdAt" DESC)`,
    );

    // A share can now be for groups (#187 had `public` and `users`).
    await queryRunner.query(`ALTER TABLE "paper_annotation_share" DROP CONSTRAINT IF EXISTS "CHK_paper_annotation_share_visibility"`);
    await queryRunner.query(
      `ALTER TABLE "paper_annotation_share" ADD CONSTRAINT "CHK_paper_annotation_share_visibility" CHECK ("visibility" IN ('public', 'users', 'group'))`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "paper_annotation_share_group" (
        "shareId" uuid NOT NULL REFERENCES "paper_annotation_share"("id") ON DELETE CASCADE,
        "groupId" uuid NOT NULL REFERENCES "paper_group"("id") ON DELETE CASCADE,
        CONSTRAINT "PK_paper_annotation_share_group" PRIMARY KEY ("shareId", "groupId")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_paper_annotation_share_group_group" ON "paper_annotation_share_group" ("groupId")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "paper_annotation_share_group"`);
    await queryRunner.query(`DELETE FROM "paper_annotation_share" WHERE "visibility" = 'group'`);
    await queryRunner.query(`ALTER TABLE "paper_annotation_share" DROP CONSTRAINT IF EXISTS "CHK_paper_annotation_share_visibility"`);
    await queryRunner.query(
      `ALTER TABLE "paper_annotation_share" ADD CONSTRAINT "CHK_paper_annotation_share_visibility" CHECK ("visibility" IN ('public', 'users'))`,
    );
    for (const table of ['paper_group_post', 'paper_group_paper', 'paper_group_invitation', 'paper_group_member', 'paper_group']) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    }
  }
}
