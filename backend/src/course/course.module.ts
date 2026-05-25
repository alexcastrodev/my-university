import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CourseModule as CourseModuleEntity } from '../lesson/course-module.entity';
import { Lesson } from '../lesson/lesson.entity';
import { Progress } from '../progress/progress.entity';
import { ContentController } from './content.controller';
import { CourseController } from './course.controller';
import { Course } from './course.entity';
import { CourseService } from './course.service';

@Module({
  imports: [TypeOrmModule.forFeature([Course, CourseModuleEntity, Lesson, Progress])],
  controllers: [CourseController, ContentController],
  providers: [CourseService],
  exports: [CourseService],
})
export class CourseNestModule {}
