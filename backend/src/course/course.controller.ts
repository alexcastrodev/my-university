import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { CourseService } from './course.service';

@Controller('courses')
export class CourseController {
  constructor(private service: CourseService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const course = await this.service.findOne(id);
    if (!course) throw new NotFoundException();
    return course;
  }
}
