import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Course } from './course.entity';
import { Lesson, LessonStatus } from '../lesson/lesson.entity';
import { Progress } from '../progress/progress.entity';
import { findNextLesson } from './resume';

export interface ResumePoint {
  courseId: string;
  courseTitle: string;
  lessonId: string | null;
  lessonTitle: string | null;
}

@Injectable()
export class CourseService {
  constructor(
    @InjectRepository(Course) private repo: Repository<Course>,
    @InjectRepository(Lesson) private lessonRepo: Repository<Lesson>,
    @InjectRepository(Progress) private progressRepo: Repository<Progress>,
  ) {}

  async findAll(userId: number | null = null): Promise<Course[]> {
    const courses = await this.repo.find({
      relations: { modules: { lessons: true } },
      order: { modules: { order: 'ASC', lessons: { order: 'ASC' } } },
    });
    if (!userId) return courses;
    return Promise.all(courses.map((course) => this.applyUserProgress(course, userId)));
  }

  async findOne(id: string, userId: number | null = null): Promise<Course | null> {
    const course = await this.repo.findOne({
      where: { id },
      relations: { modules: { lessons: true } },
      order: { modules: { order: 'ASC', lessons: { order: 'ASC' } } },
    });
    if (!course || !userId) return course;
    return this.applyUserProgress(course, userId);
  }

  findLesson(lessonId: string): Promise<Lesson | null> {
    return this.lessonRepo.findOne({ where: { id: lessonId } });
  }

  async findResumePoint(userId: number): Promise<ResumePoint | null> {
    const lastCompleted = await this.progressRepo.findOne({
      where: { userId, status: 'completed' },
      order: { updatedAt: 'DESC' },
    });
    if (!lastCompleted) return null;

    const course = await this.repo.findOne({
      where: { id: lastCompleted.courseId },
      relations: { modules: { lessons: true } },
      order: { modules: { order: 'ASC', lessons: { order: 'ASC' } } },
    });
    if (!course) return null;

    const next = findNextLesson(course, lastCompleted.lessonId);
    return {
      courseId: course.id,
      courseTitle: course.title,
      lessonId: next?.id ?? null,
      lessonTitle: next?.title ?? null,
    };
  }

  private async applyUserProgress(course: Course, userId: number): Promise<Course> {
    const progress = await this.progressRepo.find({ where: { userId, courseId: course.id } });
    const progressMap = new Map(progress.map((item) => [item.lessonId, item.status]));

    return {
      ...course,
      modules: course.modules.map((mod) => ({
        ...mod,
        lessons: mod.lessons.map((lesson) => ({
          ...lesson,
          status: progressMap.get(lesson.id) ?? (lesson.status as LessonStatus),
        })),
      })),
    };
  }
}
