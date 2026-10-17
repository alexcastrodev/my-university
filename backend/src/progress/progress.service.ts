import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Lesson, LessonStatus } from '../lesson/lesson.entity';
import { User } from '../auth/user.entity';
import type { AwardView } from '../achievements/view';
import { XpService } from '../xp/xp.service';
import { Progress } from './progress.entity';

const LESSON_STATUSES: readonly LessonStatus[] = ['new', 'in-progress', 'completed', 'not-attempted'];

@Injectable()
export class ProgressService {
  constructor(
    @InjectRepository(Progress) private repo: Repository<Progress>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Lesson) private lessonRepo: Repository<Lesson>,
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
  ): Promise<Progress & { newAwards: AwardView[] }> {
    const userExists = await this.userRepo.existsBy({ id: userId });
    if (!userExists) throw new UnauthorizedException();

    // The status and the lesson come from the URL and body: completing a lesson grants XP, so an
    // invented lesson id (or a lesson of another course) must never reach the XP ledger.
    if (!LESSON_STATUSES.includes(status)) throw new BadRequestException('Invalid status');
    const lessonInCourse = await this.lessonRepo
      .createQueryBuilder('l')
      .innerJoin('l.module', 'm')
      .innerJoin('m.course', 'c')
      .where('l.id = :lessonId AND c.id = :courseId', { lessonId, courseId })
      .getExists();
    if (!lessonInCourse) throw new NotFoundException();

    const write = async (manager: EntityManager): Promise<Progress> => {
      const repo = manager.getRepository(Progress);
      const progress = (await repo.findOne({ where: { userId, courseId, lessonId } })) ?? repo.create({ userId, courseId, lessonId });
      progress.status = status;
      return repo.save(progress);
    };
    if (status !== 'completed') return { ...(await write(this.repo.manager)), newAwards: [] };

    let saved!: Progress;
    const newAwards = await this.xpService.grantLessonXp(userId, lessonId, async (manager) => {
      saved = await write(manager);
    });
    return { ...saved, newAwards };
  }

  async getMap(userId: number, courseId: string): Promise<Record<string, LessonStatus>> {
    const all = await this.findAll(userId, courseId);
    return Object.fromEntries(all.map((p) => [p.lessonId, p.status]));
  }
}
