import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { costNanoUsd, creditsFor, ModelPrice, ModelUsage } from './ai-cost';

export interface PriceRow extends ModelPrice {
  id: number;
}

/** A model with no price in force is never billed at zero: the question is refused. */
export class NoPriceError extends Error {
  constructor(model: string) {
    super(`no price in force for the model ${model}`);
  }
}

/** A `pending` row older than this belongs to a request that died (a replica restarted): it stops blocking. */
const PENDING_DEAD_AFTER = '2 minutes';

export type FinishedStatus = 'ok' | 'incomplete' | 'error' | 'blocked';

/**
 * One row of `ai_usage` per question (#322), written as `pending` before the model is called. A partial
 * unique index allows one pending row per user, which is what holds "one question at a time" across both
 * API replicas: the second insert fails and the student is told to wait.
 */
@Injectable()
export class AiUsageService {
  constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}

  /** The price of `model` in force now. Throws `NoPriceError` when there is none. */
  async price(model: string): Promise<PriceRow> {
    const rows: PriceRow[] = await this.dataSource.query(
      `SELECT id, "inputNanoUsd", "cachedNanoUsd", "outputNanoUsd" FROM ai_model_price
        WHERE model = $1 AND "effectiveFrom" <= now() ORDER BY "effectiveFrom" DESC LIMIT 1`,
      [model],
    );
    if (rows.length === 0) throw new NoPriceError(model);
    return rows[0];
  }

  /** Opens the question. 409 `QUESTION_IN_PROGRESS` when the student already has one running. */
  async begin(
    userId: number,
    model: string,
    conversationId: string | null = null,
  ): Promise<{ id: string; price: PriceRow }> {
    const price = await this.price(model);
    return this.dataSource.transaction(async (m) => {
      await m.query(
        `UPDATE ai_usage SET status = 'error' WHERE "userId" = $1 AND status = 'pending' AND "createdAt" < now() - interval '${PENDING_DEAD_AFTER}'`,
        [userId],
      );
      try {
        const rows: { id: string }[] = await m.query(
          `INSERT INTO ai_usage ("userId", "conversationId", model, "priceId") VALUES ($1, $2, $3, $4) RETURNING id`,
          [userId, conversationId, model, price.id],
        );
        return { id: rows[0].id, price };
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new ConflictException({
            code: 'QUESTION_IN_PROGRESS',
            message: 'A question is already being answered',
          });
        throw error;
      }
    });
  }

  /**
   * Closes the question with what the API reported. An `incomplete` or `error` one is billed too when the API
   * gave tokens (it charged us). `raw` is the `usage` object as it came, to recompute if the formula was wrong.
   */
  async finish(
    id: string,
    status: FinishedStatus,
    usage: ModelUsage | null,
    price: ModelPrice,
    raw: unknown,
  ): Promise<{ costNanoUsd: number; credits: number }> {
    const cost = usage ? costNanoUsd(usage, price) : 0;
    const credits = usage ? creditsFor(cost) : 0;
    await this.dataSource.query(
      `UPDATE ai_usage SET status = $2, "inputTokens" = $3, "cachedTokens" = $4, "outputTokens" = $5, "thoughtTokens" = $6,
              "costNanoUsd" = $7, credits = $8, "usageRaw" = $9 WHERE id = $1`,
      [
        id,
        status,
        usage?.input ?? 0,
        Math.min(usage?.cached ?? 0, usage?.input ?? 0),
        usage?.output ?? 0,
        usage?.thought ?? 0,
        cost,
        credits,
        raw === undefined ? null : JSON.stringify(raw),
      ],
    );
    return { costNanoUsd: cost, credits };
  }
}
