import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A trail of what happens to a reader's files and shares (#189): upload, download, delete, share, revoke,
 * and a paper leaving the library. A row says who did what to which paper and when, with a small `detail`
 * that never holds a file name, text or address. It is read and written with SQL, so there is no entity.
 *
 * `userId` is set to null when the reader's account goes, so the trail outlives the person without pointing
 * at them; the rows are purged after a retention period (see PaperAuditService).
 */
export class AddPaperAuditEvents1764000000029 implements MigrationInterface {
  name = 'AddPaperAuditEvents1764000000029';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "paper_audit_event" (
        "id" uuid NOT NULL DEFAULT uuidv7(),
        "userId" integer REFERENCES "user"("id") ON DELETE SET NULL,
        "action" character varying(32) NOT NULL,
        "paperId" character varying(100),
        "detail" jsonb NOT NULL DEFAULT '{}',
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_paper_audit_event" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_paper_audit_event_user" ON "paper_audit_event" ("userId", "createdAt" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_paper_audit_event_created" ON "paper_audit_event" ("createdAt")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "paper_audit_event"`);
  }
}
