import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReplaceUserWithGithubAuth1764000000004 implements MigrationInterface {
  name = 'ReplaceUserWithGithubAuth1764000000004';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      TRUNCATE "user_xp_entry", "user_lesson_progress", "user" RESTART IDENTITY CASCADE
    `);

    await queryRunner.query(`UPDATE "exam_attempt" SET "userId" = NULL`);

    await queryRunner.query(
      `ALTER TABLE "user" DROP CONSTRAINT "UQ_user_normalizedName"`,
    );
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "normalizedName"`);

    await queryRunner.query(`
      ALTER TABLE "user"
      ADD COLUMN "githubId" character varying NOT NULL,
      ADD COLUMN "githubLogin" character varying NOT NULL,
      ADD COLUMN "avatarUrl" character varying NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "user"
      ADD CONSTRAINT "UQ_user_githubId" UNIQUE ("githubId")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" DROP CONSTRAINT "UQ_user_githubId"`,
    );
    await queryRunner.query(`
      ALTER TABLE "user"
      DROP COLUMN "avatarUrl",
      DROP COLUMN "githubLogin",
      DROP COLUMN "githubId"
    `);
    await queryRunner.query(`
      ALTER TABLE "user"
      ADD COLUMN "normalizedName" character varying NOT NULL DEFAULT ''
    `);
    await queryRunner.query(
      `ALTER TABLE "user" ALTER COLUMN "normalizedName" DROP DEFAULT`,
    );
    await queryRunner.query(`
      ALTER TABLE "user"
      ADD CONSTRAINT "UQ_user_normalizedName" UNIQUE ("normalizedName")
    `);
  }
}
