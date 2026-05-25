import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: 'ocp-java.db',
      entities: [Course, CourseModuleEntity, Lesson, Progress, Exam, Question, ExamAttempt],
      synchronize: true,
    }),
    CourseNestModule,
    ProgressModule,
    ExamModule,
    SeedModule,
  ],
})
export class AppModule {}
