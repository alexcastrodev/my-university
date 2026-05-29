import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { OptionalUserId } from '../auth/session';
import { CourseService } from './course.service';

@Controller('courses')
export class CourseController {
  constructor(private service: CourseService) {}

  @Get()
  findAll(@OptionalUserId() userId: number | null) {
    return this.service.findAll(userId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @OptionalUserId() userId: number | null) {
    const course = await this.service.findOne(id, userId);
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
