import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  AiBlock,
  nextUtcDay,
  nextUtcMonth,
  percentUsed,
  platformBudgetUsd,
} from './ai-cost';

export interface PlatformBudgetView {
  /** The period closest to its limit: the one the student is shown. */
  period: 'day' | 'month';
  usedPercent: number;
  resetsAt: string;
}

/**
 * The platform budget (#317): what all students together may spend on the model in a UTC day and in a UTC
 * month, in real US$ (the sum of `ai_usage.costNanoUsd`, not of rounded credits, so it matches Google's bill).
 * Once spent, nobody asks, whatever their balance. `allows()` is the one place this is decided, and today it
 * never makes an exception; the day someone can pay for credits, the exception goes here.
 */
@Injectable()
export class PlatformBudgetService {
  constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}

  /** Spent so far this UTC day and this UTC month, in nano-US$. */
  async spent(): Promise<{ day: number; month: number }> {
    const rows: { day: number; month: number }[] = await this.dataSource.query(
      `SELECT COALESCE(SUM("costNanoUsd") FILTER (WHERE "createdAt" >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0)::float8 AS day,
              COALESCE(SUM("costNanoUsd"), 0)::float8 AS month
         FROM ai_usage WHERE "createdAt" >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
    );
    return rows[0];
  }

  /** null when a question may go on, or why not. The month is checked first: it lasts longer. */
  async allows(now = new Date()): Promise<AiBlock | null> {
    const spent = await this.spent();
    const budget = platformBudgetUsd();
    if (spent.month >= budget.monthly * 1e9)
      return {
        reason: 'PLATFORM_BUDGET_MONTHLY',
        resetsAt: nextUtcMonth(now).toISOString(),
      };
    if (spent.day >= budget.daily * 1e9)
      return {
        reason: 'PLATFORM_BUDGET_DAILY',
        resetsAt: nextUtcDay(now).toISOString(),
      };
    return null;
  }

  /** The percent of each budget spent, with no dollar amount: what a student may see. */
  async view(now = new Date()): Promise<PlatformBudgetView> {
    const spent = await this.spent();
    const budget = platformBudgetUsd();
    const day = percentUsed(spent.day, budget.daily);
    const month = percentUsed(spent.month, budget.monthly);
    return day > month
      ? {
          period: 'day',
          usedPercent: day,
          resetsAt: nextUtcDay(now).toISOString(),
        }
      : {
          period: 'month',
          usedPercent: month,
          resetsAt: nextUtcMonth(now).toISOString(),
        };
  }

  /** The same in US$, with the budgets: for the admin only. */
  async adminView(): Promise<{
    day: { spentUsd: number; budgetUsd: number };
    month: { spentUsd: number; budgetUsd: number };
  }> {
    const spent = await this.spent();
    const budget = platformBudgetUsd();
    return {
      day: { spentUsd: spent.day / 1e9, budgetUsd: budget.daily },
      month: { spentUsd: spent.month / 1e9, budgetUsd: budget.monthly },
    };
  }
}
