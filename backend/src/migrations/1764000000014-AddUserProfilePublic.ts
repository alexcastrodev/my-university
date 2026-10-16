import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Public learner profiles: on by default (`profilePublic`), each one reachable only through an id
 * that is not the GitHub login (a login can be renamed and handed to someone else, and is not
 * unique in this schema). `uuidv7()` is PostgreSQL 18 native. It is a volatile default, so adding
 * the column evaluates it once per existing row and every current user gets a distinct id.
 */
export class AddUserProfilePublic1764000000014 implements MigrationInterface {
  name = 'AddUserProfilePublic1764000000014';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "profilePublic" boolean NOT NULL DEFAULT true`);
    await queryRunner.query(`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "publicProfileId" uuid NOT NULL DEFAULT uuidv7()`);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "user" ADD CONSTRAINT "UQ_user_publicProfileId" UNIQUE ("publicProfileId");
      EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
      END $$
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT IF EXISTS "UQ_user_publicProfileId"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN IF EXISTS "publicProfileId"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN IF EXISTS "profilePublic"`);
  }
}
