import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LessonStatus } from '../lesson/lesson.entity';
import { Progress } from './progress.entity';

@Injectable()
export class ProgressService {
  constructor(@InjectRepository(Progress) private repo: Repository<Progress>) {}

  findAll(userId: number, courseId: string): Promise<Progress[]> {
    return this.repo.find({ where: { userId, courseId } });
  }

  async upsert(
    userId: number,
    courseId: string,
    lessonId: string,
    status: LessonStatus,
  ): Promise<Progress> {
    let progress = await this.repo.findOne({ where: { userId, courseId, lessonId } });
    if (!progress) {
      progress = this.repo.create({ userId, courseId, lessonId });
    }
    progress.status = status;
    return this.repo.save(progress);
  }

  async getMap(userId: number, courseId: string): Promise<Record<string, LessonStatus>> {
    const all = await this.findAll(userId, courseId);
    return Object.fromEntries(all.map((p) => [p.lessonId, p.status]));
  }
}
