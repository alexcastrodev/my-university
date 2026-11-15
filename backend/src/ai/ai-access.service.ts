import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AiBlock } from './ai-cost';
import { AiCreditsService } from './ai-credits.service';
import {
  PlatformBudgetService,
  PlatformBudgetView,
} from './platform-budget.service';

export interface AiStatus {
  balance: number;
  /** The student's own limit: credits they may spend in any 24 hours, and what they have spent in the last 24. */
  dailyLimit: number;
  usedLast24h: number;
  platformBudget: PlatformBudgetView;
  /** Why they cannot ask right now, or null. */
  blocked: AiBlock | null;
}

/**
 * May this student ask the model now? The checks run in an order that decides which reason they read: what
 * touches everybody first (the platform budget, month then day), then the student's own limit, then their
 * balance. Only the first that fails is reported. The permission (`ai.use`) is the route's own check.
 */
@Injectable()
export class AiAccessService {
  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    private readonly budget: PlatformBudgetService,
    private readonly credits: AiCreditsService,
  ) {}

  /** The student's limit is the largest of their roles' `aiDailyCreditLimit`. */
  async dailyLimit(userId: number): Promise<number> {
    const rows: { limit: number }[] = await this.dataSource.query(
      `SELECT COALESCE(MAX(r."aiDailyCreditLimit"), 0)::int AS "limit" FROM user_role ur JOIN role r ON r.id = ur."roleId" WHERE ur."userId" = $1`,
      [userId],
    );
    return rows[0].limit;
  }

  /** What they spent in the last 24 hours, and when the oldest of it ages out. A moving window, so no time zone. */
  async usedLast24h(
    userId: number,
  ): Promise<{ used: number; frees: Date | null }> {
    const rows: { used: number; oldest: Date | null }[] =
      await this.dataSource.query(
        `SELECT COALESCE(SUM(credits), 0)::int AS used, MIN("createdAt") FILTER (WHERE credits > 0) AS oldest
         FROM ai_usage WHERE "userId" = $1 AND "createdAt" > now() - interval '24 hours'`,
        [userId],
      );
    const oldest = rows[0].oldest ? new Date(rows[0].oldest) : null;
    return {
      used: rows[0].used,
      frees: oldest ? new Date(oldest.getTime() + 24 * 3600 * 1000) : null,
    };
  }

  async check(userId: number, now = new Date()): Promise<AiBlock | null> {
    const platform = await this.budget.allows(now);
    if (platform) return platform;
    const [limit, window] = await Promise.all([
      this.dailyLimit(userId),
      this.usedLast24h(userId),
    ]);
    if (window.used >= limit)
      return {
        reason: 'USER_DAILY_LIMIT',
        resetsAt: window.frees?.toISOString() ?? null,
      };
    if ((await this.credits.balance(userId)) <= 0)
      return { reason: 'NO_BALANCE', resetsAt: null };
    return null;
  }

  async status(userId: number, now = new Date()): Promise<AiStatus> {
    const [balance, dailyLimit, window, platformBudget, blocked] =
      await Promise.all([
        this.credits.balance(userId),
        this.dailyLimit(userId),
        this.usedLast24h(userId),
        this.budget.view(now),
        this.check(userId, now),
      ]);
    return {
      balance,
      dailyLimit,
      usedLast24h: window.used,
      platformBudget,
      blocked,
    };
  }
}
