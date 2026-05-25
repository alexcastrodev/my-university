import { Controller, Get, Headers, NotFoundException, Param } from '@nestjs/common';
import { CourseService } from './course.service';

@Controller('courses')
export class CourseController {
  constructor(private service: CourseService) {}

  @Get()
  findAll(@Headers('x-user-id') userId: string | string[] | undefined) {
    return this.service.findAll(this.readOptionalUserId(userId));
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Headers('x-user-id') userId: string | string[] | undefined) {
    const course = await this.service.findOne(id, this.readOptionalUserId(userId));
    if (!course) throw new NotFoundException();
    return course;
  }

  @Get(':id/lessons/:lessonId')
  async findLesson(@Param('lessonId') lessonId: string) {
    const lesson = await this.service.findLesson(lessonId);
    if (!lesson) throw new NotFoundException();
    return lesson;
  }

  private readOptionalUserId(userId: string | string[] | undefined): number | null {
    const id = Number(Array.isArray(userId) ? userId[0] : userId);
    return Number.isInteger(id) && id > 0 ? id : null;
  }
}
