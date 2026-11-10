import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bookmarks: where a reader was in each module, and which labs they finished.
 *
 * `user_bookmark` holds at most one row per reader and module (`scope`: a track key such as
 * `testing-concepts`, or `cc:<module>:<discipline>` for Computer Science), so placing a bookmark in
 * a module moves the one that was there. It points at a concept by the same `sourceId` the XP ledger
 * uses, and remembers whether the reader was on the concept or on its Lab tab.
 *
 * `user_lab_done` is a reader saying "I finished this lab". It is independent of the "Got it!" read
 * mark (reading the article is not doing the exercise) and of the bookmark.
 *
 * Both are read and written with SQL, so there is no entity.
 */
export class AddBookmarks1764000000031 implements MigrationInterface {
  name = 'AddBookmarks1764000000031';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_bookmark" (
        "id" uuid NOT NULL DEFAULT uuidv7(),
        "userId" integer NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "scope" character varying(120) NOT NULL,
        "sourceId" character varying(200) NOT NULL,
        "tab" character varying(8) NOT NULL,
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_bookmark" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_user_bookmark_user_scope" UNIQUE ("userId", "scope"),
        CONSTRAINT "CHK_user_bookmark_tab" CHECK ("tab" IN ('concept', 'lab'))
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_lab_done" (
        "userId" integer NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "sourceId" character varying(200) NOT NULL,
        "doneAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_lab_done" PRIMARY KEY ("userId", "sourceId")
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_lab_done"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_bookmark"`);
  }
}
