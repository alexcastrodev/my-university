import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A vanity slug for the public profile link (`/u/<slug>`), chosen by the user and optional: without one
 * the `publicProfileId` link keeps working, and it keeps working after a slug is set. The CHECK repeats the
 * app's rules (lowercase, 3 to 30, single hyphens) so the unique index is case-insensitive in practice: only
 * lowercase can be stored. Reserved names stay an app rule, because that list will grow.
 */
export class AddUserProfileSlug1764000000015 implements MigrationInterface {
  name = 'AddUserProfileSlug1764000000015';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "profileSlug" varchar(30)`);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "user" ADD CONSTRAINT "UQ_user_profileSlug" UNIQUE ("profileSlug");
      EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
      END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "user" ADD CONSTRAINT "CK_user_profileSlug_shape"
          CHECK ("profileSlug" IS NULL OR ("profileSlug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("profileSlug") BETWEEN 3 AND 30));
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT IF EXISTS "CK_user_profileSlug_shape"`);
    await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT IF EXISTS "UQ_user_profileSlug"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN IF EXISTS "profileSlug"`);
  }
}
