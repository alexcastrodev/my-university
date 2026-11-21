import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { CurrentUserId, OptionalUserId } from '../auth/session';
import { normalizeLanguage } from '../shared/language';
import { CourseService } from './course.service';

@Controller('courses')
export class CourseController {
  constructor(private service: CourseService) {}

  @Get()
  findAll(@OptionalUserId() userId: number | null, @Query('lang') lang?: string) {
    return this.service.findAll(userId, normalizeLanguage(lang));
  }

  @Get('resume')
  findResumePoint(@CurrentUserId() userId: number, @Query('lang') lang?: string) {
    return this.service.findResumePoint(userId, normalizeLanguage(lang));
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @OptionalUserId() userId: number | null, @Query('lang') lang?: string) {
    const course = await this.service.findOne(id, userId, normalizeLanguage(lang));
    if (!course) throw new NotFoundException();
    return course;
  }

  @Get(':id/lessons/:lessonId')
  async findLesson(@Param('lessonId') lessonId: string) {
    const lesson = await this.service.findLesson(lessonId);
    if (!lesson) throw new NotFoundException();
    return lesson;
  }
}
