import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserXpEntry } from './user-xp.entity';

@Injectable()
export class XpService {
  constructor(@InjectRepository(UserXpEntry) private repo: Repository<UserXpEntry>) {}

  async grantLessonXp(userId: number, lessonId: string): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .insert()
      .into(UserXpEntry)
      .values({ userId, sourceType: 'lesson', sourceId: lessonId, exp: 10 })
      .orIgnore()
      .execute();
  }

  async grantSkillCheckXp(userId: number, examId: string, score: number, total: number): Promise<void> {
    const exp = total > 0 ? Math.round((score / total) * 50) : 0;
    await this.repo
      .createQueryBuilder()
      .insert()
      .into(UserXpEntry)
      .values({ userId, sourceType: 'skill-check', sourceId: examId, exp })
      .orUpdate(['exp', 'updatedAt'], ['userId', 'sourceType', 'sourceId'])
      .execute();
  }

  async getUserXp(userId: number): Promise<{ total: number }> {
    const result = await this.repo
      .createQueryBuilder('x')
      .select('COALESCE(SUM(x.exp), 0)', 'total')
      .where('x.userId = :userId', { userId })
      .getRawOne<{ total: string }>();
    return { total: Number(result?.total ?? 0) };
  }
}
