import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialPostgresSchema1764000000000 implements MigrationInterface {
  name = 'InitialPostgresSchema1764000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "user" (
        "id" SERIAL NOT NULL,
        "displayName" character varying NOT NULL,
        "normalizedName" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_user_normalizedName" UNIQUE ("normalizedName"),
        CONSTRAINT "PK_user_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "course" (
        "id" character varying NOT NULL,
        "title" character varying NOT NULL,
        "tag" character varying NOT NULL,
        "audience" character varying NOT NULL,
        "moduleCount" integer NOT NULL,
        "duration" character varying NOT NULL,
        "description" text NOT NULL,
        "benefits" jsonb NOT NULL,
        CONSTRAINT "PK_course_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "course_module" (
        "id" SERIAL NOT NULL,
        "order" integer NOT NULL,
        "title" character varying NOT NULL,
        "courseId" character varying,
        CONSTRAINT "PK_course_module_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "lesson" (
        "id" character varying NOT NULL,
        "title" character varying NOT NULL,
        "duration" character varying,
        "type" character varying NOT NULL,
        "status" character varying NOT NULL DEFAULT 'new',
        "contentPath" text,
        "moduleId" integer,
        CONSTRAINT "PK_lesson_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "exam" (
        "id" character varying NOT NULL,
        "title" character varying NOT NULL,
        "category" character varying NOT NULL,
        "version" character varying NOT NULL,
        "delivery" character varying NOT NULL DEFAULT 'Proctored Online',
        "format" character varying NOT NULL DEFAULT 'Multiple Choice',
        "durationMinutes" integer NOT NULL DEFAULT 120,
        "questionCount" integer NOT NULL DEFAULT 50,
        "passingScore" integer NOT NULL DEFAULT 68,
        CONSTRAINT "PK_exam_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "question" (
        "id" SERIAL NOT NULL,
        "examId" character varying NOT NULL,
        "topic" character varying NOT NULL,
        "text" text NOT NULL,
        "code" text,
        "options" jsonb NOT NULL,
        "correctKeys" jsonb NOT NULL,
        "type" character varying NOT NULL,
        "explanation" text,
        "source" text,
        CONSTRAINT "PK_question_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "exam_attempt" (
        "id" SERIAL NOT NULL,
        "examId" character varying NOT NULL,
        "startedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "finishedAt" TIMESTAMP,
        "score" integer NOT NULL DEFAULT 0,
        "total" integer NOT NULL DEFAULT 0,
        "answers" jsonb NOT NULL,
        CONSTRAINT "PK_exam_attempt_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "user_lesson_progress" (
        "id" SERIAL NOT NULL,
        "userId" integer NOT NULL,
        "courseId" character varying NOT NULL,
        "lessonId" character varying NOT NULL,
        "status" character varying NOT NULL DEFAULT 'new',
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_user_lesson_progress_scope" UNIQUE ("userId", "courseId", "lessonId"),
        CONSTRAINT "PK_user_lesson_progress_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "course_module"
      ADD CONSTRAINT "FK_course_module_course"
      FOREIGN KEY ("courseId") REFERENCES "course"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "lesson"
      ADD CONSTRAINT "FK_lesson_module"
      FOREIGN KEY ("moduleId") REFERENCES "course_module"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "question"
      ADD CONSTRAINT "FK_question_exam"
      FOREIGN KEY ("examId") REFERENCES "exam"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "exam_attempt"
      ADD CONSTRAINT "FK_exam_attempt_exam"
      FOREIGN KEY ("examId") REFERENCES "exam"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "user_lesson_progress"
      ADD CONSTRAINT "FK_user_lesson_progress_user"
      FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "user_lesson_progress"
      ADD CONSTRAINT "FK_user_lesson_progress_course"
      FOREIGN KEY ("courseId") REFERENCES "course"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user_lesson_progress" DROP CONSTRAINT "FK_user_lesson_progress_course"`);
    await queryRunner.query(`ALTER TABLE "user_lesson_progress" DROP CONSTRAINT "FK_user_lesson_progress_user"`);
    await queryRunner.query(`ALTER TABLE "exam_attempt" DROP CONSTRAINT "FK_exam_attempt_exam"`);
    await queryRunner.query(`ALTER TABLE "question" DROP CONSTRAINT "FK_question_exam"`);
    await queryRunner.query(`ALTER TABLE "lesson" DROP CONSTRAINT "FK_lesson_module"`);
    await queryRunner.query(`ALTER TABLE "course_module" DROP CONSTRAINT "FK_course_module_course"`);
    await queryRunner.query(`DROP TABLE "user_lesson_progress"`);
    await queryRunner.query(`DROP TABLE "exam_attempt"`);
    await queryRunner.query(`DROP TABLE "question"`);
    await queryRunner.query(`DROP TABLE "exam"`);
    await queryRunner.query(`DROP TABLE "lesson"`);
    await queryRunner.query(`DROP TABLE "course_module"`);
    await queryRunner.query(`DROP TABLE "course"`);
    await queryRunner.query(`DROP TABLE "user"`);
  }
}
