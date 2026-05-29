import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import type { LessonStatus } from '../lesson/lesson.entity';
import { CurrentUserId } from '../auth/session';
import { ProgressService } from './progress.service';

@Controller('progress')
export class ProgressController {
  constructor(private service: ProgressService) {}

  @Get(':courseId')
  getMap(@CurrentUserId() userId: number, @Param('courseId') courseId: string) {
    return this.service.getMap(userId, courseId);
  }

  @Put(':courseId/:lessonId')
  upsert(
    @CurrentUserId() userId: number,
    @Param('courseId') courseId: string,
    @Param('lessonId') lessonId: string,
    @Body('status') status: LessonStatus,
  ) {
    return this.service.upsert(userId, courseId, lessonId, status);
  }
}
