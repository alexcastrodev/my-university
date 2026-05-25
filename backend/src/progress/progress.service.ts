import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LessonStatus } from '../lesson/lesson.entity';
import { Progress } from './progress.entity';

@Injectable()
export class ProgressService {
  constructor(@InjectRepository(Progress) private repo: Repository<Progress>) {}

  findAll(): Promise<Progress[]> {
    return this.repo.find();
  }

  async upsert(lessonId: string, status: LessonStatus): Promise<Progress> {
    let progress = await this.repo.findOne({ where: { lessonId } });
    if (!progress) {
      progress = this.repo.create({ lessonId });
    }
    progress.status = status;
    return this.repo.save(progress);
  }

  async getMap(): Promise<Record<string, LessonStatus>> {
    const all = await this.repo.find();
    return Object.fromEntries(all.map((p) => [p.lessonId, p.status]));
  }
}
