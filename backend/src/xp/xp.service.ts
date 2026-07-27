import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { getLevelForXp, LevelProgress } from './levels';
import { UserXpEntry } from './user-xp.entity';

export type XpSourceType = UserXpEntry['sourceType'];

export interface XpSummary {
  total: number;
  level: LevelProgress;
  breakdown: { sourceType: XpSourceType; total: number }[];
}

@Injectable()
export class XpService {
  constructor(
    @InjectRepository(UserXpEntry) private repo: Repository<UserXpEntry>,
  ) {}

  private async awardOnce(
    userId: number,
    sourceType: XpSourceType,
    sourceId: string,
    exp: number,
  ): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .insert()
      .into(UserXpEntry)
      .values({ userId, sourceType, sourceId, exp })
      .orIgnore()
      .execute();
  }

  async grantLessonXp(userId: number, lessonId: string): Promise<void> {
    await this.awardOnce(userId, 'lesson', lessonId, 10);
  }

  async grantConceptReadXp(userId: number, slug: string): Promise<void> {
    await this.awardOnce(userId, 'concept-read', slug, 10);
  }

  async grantEpisodeWatchedXp(userId: number, slug: string): Promise<void> {
    await this.awardOnce(userId, 'episode-watched', slug, 10);
  }

  async grantSkillCheckXp(
    userId: number,
    examId: string,
    score: number,
    total: number,
  ): Promise<void> {
    const exp = total > 0 ? Math.round((score / total) * 50) : 0;
    await this.repo
      .createQueryBuilder()
      .insert()
      .into(UserXpEntry)
      .values({ userId, sourceType: 'skill-check', sourceId: examId, exp })
      .orUpdate(['exp', 'updatedAt'], ['userId', 'sourceType', 'sourceId'])
      .execute();
  }

  async hasEntry(
    userId: number,
    sourceType: XpSourceType,
    sourceId: string,
  ): Promise<boolean> {
    const count = await this.repo.count({
      where: { userId, sourceType, sourceId },
    });
    return count > 0;
  }

  async getUserXp(userId: number): Promise<{ total: number }> {
    const result = await this.repo
      .createQueryBuilder('x')
      .select('COALESCE(SUM(x.exp), 0)', 'total')
      .where('x.userId = :userId', { userId })
      .getRawOne<{ total: string }>();
    return { total: Number(result?.total ?? 0) };
  }

  async getSummary(userId: number): Promise<XpSummary> {
    const rows = await this.repo
      .createQueryBuilder('x')
      .select('x.sourceType', 'sourceType')
      .addSelect('COALESCE(SUM(x.exp), 0)', 'total')
      .where('x.userId = :userId', { userId })
      .groupBy('x.sourceType')
      .getRawMany<{ sourceType: XpSourceType; total: string }>();

    const breakdown = rows.map((row) => ({
      sourceType: row.sourceType,
      total: Number(row.total),
    }));
    const total = breakdown.reduce((sum, row) => sum + row.total, 0);

    return { total, level: getLevelForXp(total), breakdown };
  }

  async getHistory(userId: number, limit = 50): Promise<UserXpEntry[]> {
    return this.repo.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
      take: limit,
    });
  }
}
