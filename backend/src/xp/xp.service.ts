import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { fromSourceId } from '../review/review.constants';
import { getLevelForXp, LevelProgress } from './levels';
import { computeStreak, StreakResult, toUtcDateKey } from './streak';
import { UserXpEntry } from './user-xp.entity';

export type XpSourceType = UserXpEntry['sourceType'];

export interface XpSummary {
  total: number;
  level: LevelProgress;
  breakdown: { sourceType: XpSourceType; total: number }[];
}

/** Fixed daily XP goal — not user-configurable. Reachable via one lesson + one concept-read, or half a skill-check. */
export const DAILY_XP_GOAL = 30;

export interface DailyGoalStatus {
  earnedToday: number;
  goal: number;
}

export interface LeaderboardEntry {
  userId: number;
  displayName: string;
  avatarUrl: string;
  total: number;
  levelNumber: number;
}

export interface AreaXpBreakdownEntry {
  module: string;
  xp: number;
  lastActivityAt: string;
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

  /** All sourceIds a user has an entry for under a given sourceType — for marking a whole list as read/unread in one query. */
  async getReadSourceIds(
    userId: number,
    sourceType: XpSourceType,
  ): Promise<Set<string>> {
    const rows = await this.repo.find({
      where: { userId, sourceType },
      select: { sourceId: true },
    });
    return new Set(rows.map((row) => row.sourceId));
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

  /** All entries since a given instant — unlike `getHistory`, not capped by count, so a "this
   *  week" view doesn't silently truncate for a very active user. */
  async getHistorySince(userId: number, since: Date): Promise<UserXpEntry[]> {
    return this.repo.find({
      where: { userId, updatedAt: MoreThanOrEqual(since) },
      order: { updatedAt: 'DESC' },
    });
  }

  /** Current + longest consecutive-UTC-day study streak, derived from distinct activity days in `user_xp_entry`. */
  async getStreak(userId: number): Promise<StreakResult> {
    const rows = await this.repo
      .createQueryBuilder('x')
      .select("to_char(x.updatedAt, 'YYYY-MM-DD')", 'day')
      .distinct(true)
      .where('x.userId = :userId', { userId })
      .getRawMany<{ day: string }>();

    const today = toUtcDateKey(new Date());
    return computeStreak(
      rows.map((row) => row.day),
      today,
    );
  }

  /** How much XP the user has earned today (UTC calendar day) against the fixed daily goal. */
  async getDailyGoalStatus(userId: number): Promise<DailyGoalStatus> {
    const today = toUtcDateKey(new Date());
    const result = await this.repo
      .createQueryBuilder('x')
      .select('COALESCE(SUM(x.exp), 0)', 'total')
      .where('x.userId = :userId', { userId })
      .andWhere("to_char(x.updatedAt, 'YYYY-MM-DD') = :today", { today })
      .getRawOne<{ total: string }>();

    return { earnedToday: Number(result?.total ?? 0), goal: DAILY_XP_GOAL };
  }

  /**
   * XP and last-activity timestamp per Complementary Studies area (java-concepts,
   * jvm-concepts, ...), derived from real `user_xp_entry` rows — reuses the same
   * module/prefix registry `ReviewService` already resolves due-queue items with, so
   * there's one source of truth for "which area does this sourceId belong to."
   * Entries that don't resolve to a known area (course lessons, skill checks) are
   * skipped — they're tracked separately via the course resume point.
   */
  async getAreaBreakdown(userId: number): Promise<AreaXpBreakdownEntry[]> {
    const rows = await this.repo.find({
      where: { userId },
      select: { sourceType: true, sourceId: true, exp: true, updatedAt: true },
    });

    const byModule = new Map<string, { xp: number; lastActivityAt: Date }>();
    for (const row of rows) {
      if (row.sourceType !== 'concept-read' && row.sourceType !== 'episode-watched') continue;
      const resolved = fromSourceId(row.sourceType, row.sourceId);
      if (!resolved) continue;

      const existing = byModule.get(resolved.module);
      if (existing) {
        existing.xp += row.exp;
        if (row.updatedAt > existing.lastActivityAt) existing.lastActivityAt = row.updatedAt;
      } else {
        byModule.set(resolved.module, { xp: row.exp, lastActivityAt: row.updatedAt });
      }
    }

    return Array.from(byModule.entries()).map(([module, v]) => ({
      module,
      xp: v.xp,
      lastActivityAt: v.lastActivityAt.toISOString(),
    }));
  }

  /** Top users by total XP across all sources, for the profile leaderboard. */
  async getLeaderboard(limit = 10): Promise<LeaderboardEntry[]> {
    const rows = await this.repo
      .createQueryBuilder('x')
      .innerJoin('x.user', 'u')
      .select('x.userId', 'userId')
      .addSelect('u.displayName', 'displayName')
      .addSelect('u.displayNameOverride', 'displayNameOverride')
      .addSelect('u.avatarUrl', 'avatarUrl')
      .addSelect('COALESCE(SUM(x.exp), 0)', 'total')
      .groupBy('x.userId')
      .addGroupBy('u.displayName')
      .addGroupBy('u.displayNameOverride')
      .addGroupBy('u.avatarUrl')
      .orderBy('total', 'DESC')
      .limit(limit)
      .getRawMany<{
        userId: number;
        displayName: string;
        displayNameOverride: string | null;
        avatarUrl: string;
        total: string;
      }>();

    return rows.map((row) => {
      const total = Number(row.total);
      return {
        userId: row.userId,
        displayName: row.displayNameOverride ?? row.displayName,
        avatarUrl: row.avatarUrl,
        total,
        levelNumber: getLevelForXp(total).number,
      };
    });
  }
}
