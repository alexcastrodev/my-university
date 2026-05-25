import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import type { LessonStatus } from '../lesson/lesson.entity';
import { ProgressService } from './progress.service';

@Controller('progress')
export class ProgressController {
  constructor(private service: ProgressService) {}

  @Get()
  getMap() {
    return this.service.getMap();
  }

  @Put(':lessonId')
  upsert(@Param('lessonId') lessonId: string, @Body('status') status: LessonStatus) {
    return this.service.upsert(lessonId, status);
  }
}
