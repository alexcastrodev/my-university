import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LessonStatus } from '../lesson/lesson.entity';
import { User } from '../auth/user.entity';
import { XpService } from '../xp/xp.service';
import { Progress } from './progress.entity';

@Injectable()
export class ProgressService {
  constructor(
    @InjectRepository(Progress) private repo: Repository<Progress>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private xpService: XpService,
  ) {}

  findAll(userId: number, courseId: string): Promise<Progress[]> {
    return this.repo.find({ where: { userId, courseId } });
  }

  async upsert(
    userId: number,
    courseId: string,
    lessonId: string,
    status: LessonStatus,
  ): Promise<Progress> {
    const userExists = await this.userRepo.existsBy({ id: userId });
    if (!userExists) throw new UnauthorizedException();

    let progress = await this.repo.findOne({ where: { userId, courseId, lessonId } });
    if (!progress) {
      progress = this.repo.create({ userId, courseId, lessonId });
    }
    progress.status = status;
    const saved = await this.repo.save(progress);
    if (status === 'completed') {
      await this.xpService.grantLessonXp(userId, lessonId);
    }
    return saved;
  }

  async getMap(userId: number, courseId: string): Promise<Record<string, LessonStatus>> {
    const all = await this.findAll(userId, courseId);
    return Object.fromEntries(all.map((p) => [p.lessonId, p.status]));
  }
}
