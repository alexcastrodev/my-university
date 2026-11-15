import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { recordAudit } from '../auth/audit';
import { AiCreditKind, maxGrantCredits } from './ai-cost';

export interface GrantView {
  id: string;
  kind: AiCreditKind;
  amount: number;
  reason: string | null;
  grantedByUserId: number | null;
  grantedByLogin: string | null;
  reversesGrantId: string | null;
  createdAt: string;
}

export interface CreditSummary {
  balance: number;
  grants: GrantView[];
  /** Per UTC day, the last 30 days with any use. */
  usage: { day: string; questions: number; credits: number; costUsd: number }[];
}

const GRANT_COLUMNS = `g.id, g.kind, g.amount, g.reason, g."grantedByUserId", u."githubLogin" AS "grantedByLogin", g."reversesGrantId", g."createdAt"`;

/**
 * The credits of a student (#322). The balance is the sum of the grants (a reversal is a negative one) minus
 * the credits spent, so there is no number anyone can edit: a mistake is fixed by a new row, and the old
 * rows stay as they were.
 */
@Injectable()
export class AiCreditsService {
  constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}

  async balance(userId: number): Promise<number> {
    const rows: { balance: number }[] = await this.dataSource.query(
      `SELECT (COALESCE((SELECT SUM(amount) FROM ai_credit_grant WHERE "userId" = $1), 0)
             - COALESCE((SELECT SUM(credits) FROM ai_usage WHERE "userId" = $1), 0))::int AS balance`,
      [userId],
    );
    return rows[0].balance;
  }

  async summary(userId: number): Promise<CreditSummary> {
    const exists: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM "user" WHERE id = $1`,
      [userId],
    );
    if (exists.length === 0) throw new NotFoundException();
    const grants: GrantView[] = await this.dataSource.query(
      `SELECT ${GRANT_COLUMNS} FROM ai_credit_grant g LEFT JOIN "user" u ON u.id = g."grantedByUserId"
        WHERE g."userId" = $1 ORDER BY g."createdAt" DESC, g.id DESC LIMIT 50`,
      [userId],
    );
    const usage: CreditSummary['usage'] = await this.dataSource.query(
      `SELECT to_char(("createdAt" AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day, count(*)::int AS questions,
              SUM(credits)::int AS credits, (SUM("costNanoUsd") / 1e9)::float8 AS "costUsd"
         FROM ai_usage WHERE "userId" = $1 AND status <> 'blocked' AND "createdAt" >= now() - interval '30 days'
        GROUP BY 1 ORDER BY 1 DESC`,
      [userId],
    );
    return { balance: await this.balance(userId), grants, usage };
  }

  /**
   * An admin gives credits. Never to themselves (the database also refuses it), and never more than
   * `AI_CREDIT_MAX_GRANT` at once, so a person who may grant cannot grant without a ceiling.
   */
  async grant(
    actorId: number,
    userId: number,
    amount: number,
    reason: string,
  ): Promise<GrantView> {
    if (actorId === userId)
      throw new BadRequestException('You cannot grant credits to yourself');
    if (amount > maxGrantCredits())
      throw new BadRequestException(
        `A grant is at most ${maxGrantCredits()} credits`,
      );
    return this.dataSource.transaction(async (m) => {
      const exists: unknown[] = await m.query(
        `SELECT 1 FROM "user" WHERE id = $1`,
        [userId],
      );
      if (exists.length === 0) throw new NotFoundException();
      const rows: { id: string }[] = await m.query(
        `INSERT INTO ai_credit_grant ("userId", kind, amount, reason, "grantedByUserId") VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [userId, AiCreditKind.ADMIN_GRANT, amount, reason, actorId],
      );
      await recordAudit(m, actorId, userId, 'credit.grant', {
        amount,
        reason,
        grantId: rows[0].id,
      });
      return this.grantIn(m, rows[0].id);
    });
  }

  /**
   * Fixes a wrong grant with a new row of the same amount, negative, that points at it. The whole grant, never
   * a part (to correct a value, reverse it and grant again), and a grant is reversed once.
   */
  async reverse(
    actorId: number,
    grantId: string,
    reason: string,
  ): Promise<GrantView> {
    return this.dataSource.transaction(async (m) => {
      const found: { userId: number; kind: AiCreditKind; amount: number }[] =
        await m.query(
          `SELECT "userId", kind, amount FROM ai_credit_grant WHERE id = $1 FOR UPDATE`,
          [grantId],
        );
      if (found.length === 0) throw new NotFoundException();
      const original = found[0];
      if (original.kind === AiCreditKind.REVERSAL)
        throw new BadRequestException('A reversal cannot be reversed');
      let id: string;
      try {
        const rows: { id: string }[] = await m.query(
          `INSERT INTO ai_credit_grant ("userId", kind, amount, reason, "grantedByUserId", "reversesGrantId")
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [
            original.userId,
            AiCreditKind.REVERSAL,
            -original.amount,
            reason,
            actorId,
            grantId,
          ],
        );
        id = rows[0].id;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new ConflictException('That grant was already reversed');
        throw error;
      }
      await recordAudit(m, actorId, original.userId, 'credit.reverse', {
        amount: original.amount,
        reason,
        grantId,
      });
      return this.grantIn(m, id);
    });
  }

  private async grantIn(
    m: { query: DataSource['query'] },
    id: string,
  ): Promise<GrantView> {
    const rows: GrantView[] = await m.query(
      `SELECT ${GRANT_COLUMNS} FROM ai_credit_grant g LEFT JOIN "user" u ON u.id = g."grantedByUserId" WHERE g.id = $1`,
      [id],
    );
    return rows[0];
  }
}
