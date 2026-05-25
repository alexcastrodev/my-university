import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Course } from './course.entity';
import { Lesson } from '../lesson/lesson.entity';

@Injectable()
export class CourseService {
  constructor(
    @InjectRepository(Course) private repo: Repository<Course>,
    @InjectRepository(Lesson) private lessonRepo: Repository<Lesson>,
  ) {}

  findAll(): Promise<Course[]> {
    return this.repo.find({ relations: { modules: { lessons: true } } });
  }

  findOne(id: string): Promise<Course | null> {
    return this.repo.findOne({
      where: { id },
      relations: { modules: { lessons: true } },
    });
  }

  findLesson(lessonId: string): Promise<Lesson | null> {
    return this.lessonRepo.findOne({ where: { id: lessonId } });
  }
}
