import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Course } from '../course/course.entity';
import { CourseModule as CourseModuleEntity } from '../lesson/course-module.entity';
import { Lesson } from '../lesson/lesson.entity';
import { Exam } from '../exam/exam.entity';
import { Question } from '../exam/question.entity';
import { SeedService } from './seed.service';

@Module({
  imports: [TypeOrmModule.forFeature([Course, CourseModuleEntity, Lesson, Exam, Question])],
  providers: [SeedService],
})
export class SeedModule {}
