import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Private PDF attachments (#183). One attachment per paper and owner, with its file versions beneath it.
 * File bytes live in object storage; these tables hold the key, the checksum and the processing state.
 *
 * `storage_deletion` is a queue of object keys to delete. A trigger fills it whenever a version row that
 * still has bytes is deleted, whatever deleted it (the API, a cascade from the paper or the user), so a
 * file cannot be orphaned by a deletion path that forgot to remove it. A worker drains the queue and
 * keeps a key in it until the object is really gone.
 */
export class AddPaperAttachments1764000000022 implements MigrationInterface {
  name = 'AddPaperAttachments1764000000022';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "paper_attachment" (
        "id" SERIAL NOT NULL,
        "paperId" integer NOT NULL,
        "ownerId" integer NOT NULL,
        "visibility" character varying NOT NULL DEFAULT 'private',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_paper_attachment_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_paper_attachment_paper_owner" UNIQUE ("paperId", "ownerId"),
        CONSTRAINT "CHK_paper_attachment_visibility" CHECK ("visibility" = 'private'),
        CONSTRAINT "FK_paper_attachment_paper" FOREIGN KEY ("paperId") REFERENCES "paper"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_paper_attachment_owner" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_paper_attachment_owner" ON "paper_attachment" ("ownerId")`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "paper_attachment_version" (
        "id" SERIAL NOT NULL,
        "attachmentId" integer NOT NULL,
        "version" integer NOT NULL,
        "state" character varying NOT NULL,
        "objectKey" text,
        "originalName" text NOT NULL,
        "mimeType" character varying NOT NULL DEFAULT 'application/pdf',
        "size" bigint NOT NULL,
        "sha256" character(64) NOT NULL,
        "uploadedById" integer NOT NULL,
        "rejectCode" character varying,
        "rejectReason" text,
        "scannedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_paper_attachment_version_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_paper_attachment_version" UNIQUE ("attachmentId", "version"),
        CONSTRAINT "UQ_paper_attachment_version_key" UNIQUE ("objectKey"),
        CONSTRAINT "CHK_paper_attachment_version_state" CHECK ("state" IN ('pending', 'approved', 'rejected', 'superseded')),
        CONSTRAINT "CHK_paper_attachment_version_mime" CHECK ("mimeType" = 'application/pdf'),
        -- Bytes exist exactly while the version is waiting for its scan or is the approved one.
        CONSTRAINT "CHK_paper_attachment_version_bytes" CHECK (("state" IN ('pending', 'approved')) = ("objectKey" IS NOT NULL)),
        CONSTRAINT "FK_paper_attachment_version_attachment" FOREIGN KEY ("attachmentId") REFERENCES "paper_attachment"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_paper_attachment_version_uploader" FOREIGN KEY ("uploadedById") REFERENCES "user"("id") ON DELETE CASCADE
      )
    `);
    // One served file and one scan in flight per attachment.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_paper_attachment_one_approved" ON "paper_attachment_version" ("attachmentId") WHERE "state" = 'approved'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_paper_attachment_one_pending" ON "paper_attachment_version" ("attachmentId") WHERE "state" = 'pending'`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "storage_deletion" (
        "id" SERIAL NOT NULL,
        "objectKey" text NOT NULL,
        "attempts" integer NOT NULL DEFAULT 0,
        "queuedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_storage_deletion_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION queue_paper_attachment_object_deletion() RETURNS trigger AS $$
      BEGIN
        IF OLD."objectKey" IS NOT NULL THEN
          INSERT INTO "storage_deletion" ("objectKey") VALUES (OLD."objectKey");
        END IF;
        RETURN OLD;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_paper_attachment_version_delete" ON "paper_attachment_version"`,
    );
    await queryRunner.query(`
      CREATE TRIGGER "trg_paper_attachment_version_delete"
      AFTER DELETE ON "paper_attachment_version"
      FOR EACH ROW EXECUTE FUNCTION queue_paper_attachment_object_deletion()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_paper_attachment_version_delete" ON "paper_attachment_version"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS queue_paper_attachment_object_deletion()`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "storage_deletion"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "paper_attachment_version"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "paper_attachment"`);
  }
}
