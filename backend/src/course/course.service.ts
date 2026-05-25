import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Course } from './course.entity';

@Injectable()
export class CourseService {
  constructor(@InjectRepository(Course) private repo: Repository<Course>) {}

  findAll(): Promise<Course[]> {
    return this.repo.find({ relations: { modules: { lessons: true } } });
  }

  findOne(id: string): Promise<Course | null> {
    return this.repo.findOne({
      where: { id },
      relations: { modules: { lessons: true } },
    });
  }
}
