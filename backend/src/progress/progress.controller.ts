import { Body, Controller, Get, Headers, Param, Put, UnauthorizedException } from '@nestjs/common';
import type { LessonStatus } from '../lesson/lesson.entity';
import { ProgressService } from './progress.service';

@Controller('progress')
export class ProgressController {
  constructor(private service: ProgressService) {}

  @Get(':courseId')
  getMap(@Headers('x-user-id') userId: string | string[] | undefined, @Param('courseId') courseId: string) {
    return this.service.getMap(this.readUserId(userId), courseId);
  }

  @Put(':courseId/:lessonId')
  upsert(
    @Headers('x-user-id') userId: string | string[] | undefined,
    @Param('courseId') courseId: string,
    @Param('lessonId') lessonId: string,
    @Body('status') status: LessonStatus,
  ) {
    return this.service.upsert(this.readUserId(userId), courseId, lessonId, status);
  }

  private readUserId(userId: string | string[] | undefined): number {
    const id = Number(Array.isArray(userId) ? userId[0] : userId);
    if (!Number.isInteger(id) || id <= 0) throw new UnauthorizedException();
    return id;
  }
}
