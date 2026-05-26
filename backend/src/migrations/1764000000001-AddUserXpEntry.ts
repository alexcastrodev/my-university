import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserXpEntry1764000000001 implements MigrationInterface {
  name = 'AddUserXpEntry1764000000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "exam_attempt"
      ADD COLUMN IF NOT EXISTS "userId" integer
    `);

    await queryRunner.query(`
      CREATE TABLE "user_xp_entry" (
        "id" SERIAL NOT NULL,
        "userId" integer NOT NULL,
        "sourceType" character varying NOT NULL,
        "sourceId" character varying NOT NULL,
        "exp" integer NOT NULL DEFAULT 0,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_user_xp_entry_scope" UNIQUE ("userId", "sourceType", "sourceId"),
        CONSTRAINT "PK_user_xp_entry_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "user_xp_entry"
      ADD CONSTRAINT "FK_user_xp_entry_user"
      FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user_xp_entry" DROP CONSTRAINT "FK_user_xp_entry_user"`);
    await queryRunner.query(`DROP TABLE "user_xp_entry"`);
    await queryRunner.query(`ALTER TABLE "exam_attempt" DROP COLUMN "userId"`);
  }
}
