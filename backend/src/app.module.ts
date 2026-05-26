import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { AuthModule } from './auth/auth.module';
import { User } from './auth/user.entity';
import { CourseNestModule } from './course/course.module';
import { Exam } from './exam/exam.entity';
import { ExamAttempt } from './exam/exam-attempt.entity';
import { ExamModule } from './exam/exam.module';
import { Question } from './exam/question.entity';
import { CourseModule as CourseModuleEntity } from './lesson/course-module.entity';
import { Lesson } from './lesson/lesson.entity';
import { Course } from './course/course.entity';
import { Progress } from './progress/progress.entity';
import { ProgressModule } from './progress/progress.module';
import { SeedModule } from './seed/seed.module';
import { UserXpEntry } from './xp/user-xp.entity';
import { XpModule } from './xp/xp.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5432/ocp_java',
      entities: [User, Course, CourseModuleEntity, Lesson, Progress, Exam, Question, ExamAttempt, UserXpEntry],
      migrations: [join(__dirname, 'migrations', '*.js')],
      migrationsRun: true,
      synchronize: false,
    }),
    AuthModule,
    CourseNestModule,
    ProgressModule,
    ExamModule,
    XpModule,
    SeedModule,
  ],
})
export class AppModule {}
