import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
import { computeProgress, evaluateAwards, unitKey, type AwardType, type Unit, type UnitSourceType } from '../achievements/catalog';
import { enabledTrackIds, getCatalog } from '../achievements/load-seed';
import { AwardView, describeAwards, describeProgress, TrackProgressView } from '../achievements/view';
import { User } from '../auth/user.entity';
import { fromSourceId, parseCurriculumSourceId } from '../concept-lookup/concept-lookup.constants';
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

/** What anyone may see of a user who left the profile public: nothing beyond this, at any depth. */
export interface PublicProfile {
  displayName: string;
  avatarUrl: string;
  level: { number: number; title: string };
  xp: number;
  badges: AwardView[];
  trophies: AwardView[];
}

const PROFILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface AchievementsView {
  awards: AwardView[];
  progress: TrackProgressView[];
}

const UNIT_TYPES: UnitSourceType[] = ['concept-read', 'lesson'];
const AWARD_TYPES: AwardType[] = ['badge', 'trophy'];

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

  /**
   * Daily-session card completion. Unlike `concept-read`/`episode-watched` (awarded once ever),
   * a daily card is re-eligible once per UTC calendar day — the same underlying concept can
   * resurface in a later day's session and still earn XP, while replaying today's session a
   * second time does not. The day key lives inside `sourceId` itself (`awardOnce`'s uniqueness
   * is per raw sourceId, there's no separate "day" column), so the caller never needs a second
   * table just to express that.
   */
  async grantDailyCardXp(
    userId: number,
    cardType: string,
    underlyingSourceId: string,
    exp: number,
  ): Promise<void> {
    const dayKey = `${cardType}:${toUtcDateKey(new Date())}:${underlyingSourceId}`;
    await this.awardOnce(userId, 'daily-card', dayKey, exp);
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
      // A range on the raw column (not `to_char(...) = :today`) so the planner can use an index on updatedAt.
      .andWhere('x.updatedAt >= CAST(:today AS date)', { today })
      .andWhere("x.updatedAt < CAST(:today AS date) + INTERVAL '1 day'")
      .getRawOne<{ total: string }>();

    return { earnedToday: Number(result?.total ?? 0), goal: DAILY_XP_GOAL };
  }

  /**
   * XP and last-activity timestamp per Complementary Studies area (java-concepts,
   * jvm-concepts, ...), derived from real `user_xp_entry` rows — reuses the same
   * module/prefix registry `ConceptLookupService` already resolves recent-activity items with, so
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
      // A Computer Science concept id (`cc:...`) has no prefix in CONCEPT_MODULES, so without
      // this check it would fall through to the unprefixed java-concepts entry.
      const module = parseCurriculumSourceId(row.sourceId)
        ? 'computer-science'
        : fromSourceId(row.sourceType, row.sourceId)?.module;
      if (!module) continue;

      const existing = byModule.get(module);
      if (existing) {
        existing.xp += row.exp;
        if (row.updatedAt > existing.lastActivityAt) existing.lastActivityAt = row.updatedAt;
      } else {
        byModule.set(module, { xp: row.exp, lastActivityAt: row.updatedAt });
      }
    }

    return Array.from(byModule.entries()).map(([module, v]) => ({
      module,
      xp: v.xp,
      lastActivityAt: v.lastActivityAt.toISOString(),
    }));
  }

  /** Awards already recorded for a user, newest first. Retired and disabled ones are included: an award is permanent. */
  private async awardRows(userId: number) {
    const rows = await this.repo.find({
      where: { userId, sourceType: In(AWARD_TYPES) },
      select: { sourceType: true, sourceId: true, exp: true, updatedAt: true },
      order: { updatedAt: 'DESC', id: 'DESC' },
    });
    return rows as { sourceType: AwardType; sourceId: string; exp: number; updatedAt: Date }[];
  }

  /** One query for everything a user has completed: unit key -> when. The input of every award decision. */
  private async unitDates(userId: number): Promise<Map<string, Date>> {
    const rows = await this.repo.find({
      where: { userId, sourceType: In(UNIT_TYPES) },
      select: { sourceType: true, sourceId: true, updatedAt: true },
    });
    return new Map(rows.map((r) => [unitKey(r as Unit), r.updatedAt]));
  }

  /** Read-only: the user's awards plus current progress on the tracks enabled for awarding. Never writes. */
  async getAchievements(userId: number): Promise<AchievementsView> {
    const catalog = getCatalog();
    const [awards, dates] = await Promise.all([this.awardRows(userId), this.unitDates(userId)]);
    const progress = computeProgress(
      catalog,
      new Set(dates.keys()),
      new Set(awards.map((a) => `${a.sourceType}:${a.sourceId}`)),
      enabledTrackIds(),
    );
    return { awards: describeAwards(catalog, awards), progress: describeProgress(catalog, progress) };
  }

  /** Awards the user has earned but that are not recorded yet, for the given tracks. Never writes. */
  private async pendingAwards(userId: number, enabled: ReadonlySet<string>) {
    const catalog = getCatalog();
    const [existing, dates] = await Promise.all([this.awardRows(userId), this.unitDates(userId)]);
    const pending = evaluateAwards(
      catalog,
      dates,
      new Set(existing.map((a) => `${a.sourceType}:${a.sourceId}`)),
      enabled,
    );
    return { catalog, pending };
  }

  /** What `syncAchievements` would record, without recording it: the backfill dry run. */
  async previewAchievements(userId: number, enabled: ReadonlySet<string> = enabledTrackIds()): Promise<AwardView[]> {
    const { catalog, pending } = await this.pendingAwards(userId, enabled);
    return describeAwards(
      catalog,
      pending.map((a) => ({ sourceType: a.sourceType, sourceId: a.sourceId, exp: a.exp, updatedAt: a.completedAt })),
    );
  }

  /**
   * Records every award the user has earned and does not have yet, and returns only the ones this
   * call inserted. Idempotent and safe to run concurrently: the unique index on (user, type, id) is
   * the guard, and `RETURNING` tells a real insert from a conflict. Each award keeps the date of the
   * latest unit that completed it, so it never creates an activity day that did not exist.
   */
  async syncAchievements(userId: number, enabled: ReadonlySet<string> = enabledTrackIds()): Promise<AwardView[]> {
    const { catalog, pending } = await this.pendingAwards(userId, enabled);

    const inserted: { sourceType: AwardType; sourceId: string; exp: number; updatedAt: Date }[] = [];
    for (const award of pending) {
      const result = await this.repo
        .createQueryBuilder()
        .insert()
        .into(UserXpEntry)
        .values({ userId, sourceType: award.sourceType, sourceId: award.sourceId, exp: award.exp, updatedAt: award.completedAt })
        .orIgnore()
        .returning('id')
        .execute();
      if (result.raw.length > 0) {
        inserted.push({ sourceType: award.sourceType, sourceId: award.sourceId, exp: award.exp, updatedAt: award.completedAt });
      }
    }
    return describeAwards(catalog, inserted);
  }

  /**
   * The public profile for an id, or null. Null covers a malformed id, an unknown id and a private
   * profile alike, so a response never reveals that a private user exists.
   */
  async getPublicProfile(publicProfileId: string): Promise<PublicProfile | null> {
    if (!PROFILE_ID.test(publicProfileId)) return null;
    const user = await this.repo.manager.getRepository(User).findOne({
      where: { publicProfileId, profilePublic: true },
      select: { id: true, displayName: true, displayNameOverride: true, avatarUrl: true },
    });
    if (!user) return null;
    const [{ total }, rows] = await Promise.all([this.getUserXp(user.id), this.awardRows(user.id)]);
    const awards = describeAwards(getCatalog(), rows);
    const level = getLevelForXp(total);
    return {
      displayName: user.displayNameOverride ?? user.displayName,
      avatarUrl: user.avatarUrl,
      level: { number: level.number, title: level.title },
      xp: total,
      badges: awards.filter((a) => a.type === 'badge'),
      trophies: awards.filter((a) => a.type === 'trophy'),
    };
  }

  /** Top users by total XP across all sources, for the profile leaderboard. */
  async getLeaderboard(limit = 10): Promise<LeaderboardEntry[]> {
    const rows = await this.repo
      .createQueryBuilder('x')
      .innerJoin('x.user', 'u')
      .where('u.profilePublic = true')
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
