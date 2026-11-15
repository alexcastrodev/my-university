import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The Kurz, the assistant of the posts (#317): who accepted its terms, the conversations it keeps, and the
 * reports of a wrong answer.
 *
 * `user.aiTermsAcceptedAt` and `aiTermsVersion` record the privacy notice and 18+ confirmation the student
 * accepted, and which text they saw. The student confirms again when `KURZ_TERMS_VERSION` moves on.
 *
 * `kurz_conversation` is private to its student: every query starts from the session user. `updatedAt` is the
 * last message, and the retention (90 days) counts from it. It identifies the page as the discussions do
 * (`topicKey`, `lang`, and the `anchorKey`/`blockIndex` of the paragraph, which the client computes), and keeps
 * the `version` of the post it was about, so a conversation can be shown as being of an older text. A whole-post
 * conversation has no anchor.
 *
 * `kurz_message` is one exchange: the question and the answer the student was shown (the validated JSON, never
 * the model's raw text). `ai_usage.conversationId` now has its foreign key as ON DELETE SET NULL: erasing the
 * conversations erases the text and leaves the bill (it has no text).
 *
 * `ai_report` is a copy that stands alone, on purpose with no foreign key to the conversation: when the
 * student erases their conversations or their account the report stays, and `userId` becomes NULL.
 */
export class AddKurz1764000000035 implements MigrationInterface {
  name = 'AddKurz1764000000035';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "aiTermsAcceptedAt" timestamp`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "aiTermsVersion" character varying(20)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "kurz_conversation" (
        "id" uuid NOT NULL DEFAULT uuidv7(),
        "userId" integer NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "topicKey" character varying(200) NOT NULL,
        "lang" character varying(10) NOT NULL,
        "anchorKey" character varying(32),
        "blockIndex" integer,
        "selection" text,
        "postVersion" character varying(20),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kurz_conversation" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_kurz_conversation_anchor" CHECK (("anchorKey" IS NULL) = ("blockIndex" IS NULL))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_kurz_conversation_user_topic" ON "kurz_conversation" ("userId", "topicKey", "lang")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_kurz_conversation_updated" ON "kurz_conversation" ("updatedAt")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "kurz_message" (
        "id" uuid NOT NULL DEFAULT uuidv7(),
        "conversationId" uuid NOT NULL REFERENCES "kurz_conversation"("id") ON DELETE CASCADE,
        "question" text NOT NULL,
        "answer" jsonb NOT NULL,
        "outcome" character varying(12) NOT NULL,
        "helpful" boolean,
        "model" character varying(60) NOT NULL,
        "promptVersion" integer NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kurz_message" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_kurz_message_outcome" CHECK ("outcome" IN ('answered', 'refused', 'unverified', 'incomplete'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_kurz_message_conversation" ON "kurz_message" ("conversationId", "createdAt")`,
    );

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "ai_usage" ADD CONSTRAINT "FK_ai_usage_conversation"
          FOREIGN KEY ("conversationId") REFERENCES "kurz_conversation"("id") ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_report" (
        "id" uuid NOT NULL DEFAULT uuidv7(),
        "userId" integer REFERENCES "user"("id") ON DELETE SET NULL,
        "messageId" uuid NOT NULL,
        "topicKey" character varying(200) NOT NULL,
        "lang" character varying(10) NOT NULL,
        "postVersion" character varying(20),
        "selection" text,
        "question" text NOT NULL,
        "answer" jsonb NOT NULL,
        "model" character varying(60) NOT NULL,
        "promptVersion" integer NOT NULL,
        "note" character varying(500),
        "status" smallint NOT NULL DEFAULT 0,
        "reviewedByUserId" integer REFERENCES "user"("id") ON DELETE SET NULL,
        "reviewedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_report" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_ai_report_message" UNIQUE ("messageId"),
        CONSTRAINT "CHK_ai_report_status" CHECK ("status" IN (0, 1, 2))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ai_report_status" ON "ai_report" ("status", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ai_report_user" ON "ai_report" ("userId")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_report"`);
    await queryRunner.query(
      `ALTER TABLE "ai_usage" DROP CONSTRAINT IF EXISTS "FK_ai_usage_conversation"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "kurz_message"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "kurz_conversation"`);
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN IF EXISTS "aiTermsVersion"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN IF EXISTS "aiTermsAcceptedAt"`,
    );
  }
}
