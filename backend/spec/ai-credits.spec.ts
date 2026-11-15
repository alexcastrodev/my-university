/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- the rows of raw SQL are untyped */
import { ConflictException } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AdminModule } from '../src/admin/admin.module';
import { AiAccessService } from '../src/ai/ai-access.service';
import { AiCreditsService } from '../src/ai/ai-credits.service';
import { AiUsageService, NoPriceError } from '../src/ai/ai-usage.service';
import { AiModule } from '../src/ai/ai.module';
import { PlatformBudgetService } from '../src/ai/platform-budget.service';
import fixtures from './fixtures/gemini-usage.json';
import { AuthApp, startAuthApp } from './auth-app';

/**
 * The credits of the Kurz (#322): the ledger and the rules the database holds for each kind of credit, the
 * balance, the price of a model, the one-question-at-a-time row, the platform budget, the student's own limit,
 * and the order in which they are checked. The admin routes that grant and reverse are tested through HTTP.
 */
let t: AuthApp;
let credits: AiCreditsService;
let usage: AiUsageService;
let access: AiAccessService;
let budget: PlatformBudgetService;
const env = {
  daily: process.env.KURZ_PLATFORM_BUDGET_DAILY_USD,
  monthly: process.env.KURZ_PLATFORM_BUDGET_MONTHLY_USD,
};

beforeAll(async () => {
  t = await startAuthApp([AdminModule, AiModule]);
  credits = t.get(AiCreditsService);
  usage = t.get(AiUsageService);
  access = t.get(AiAccessService);
  budget = t.get(PlatformBudgetService);
});
afterEach(() => {
  for (const [key, value] of [
    ['KURZ_PLATFORM_BUDGET_DAILY_USD', env.daily],
    ['KURZ_PLATFORM_BUDGET_MONTHLY_USD', env.monthly],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
afterAll(async () => {
  await t.dataSource.query(`DELETE FROM ai_model_price WHERE model LIKE $1`, [
    `test-%${t.run}`,
  ]);
  await t.close();
});

const json = async <T>(res: Response) => (await res.json()) as T;
const q = (sql: string, params: unknown[] = []): Promise<any[]> =>
  t.dataSource.query(sql, params);
const raw = fixtures.usage[0];
const asUsage = {
  input: raw.usage.total_input_tokens,
  cached: 0,
  output: raw.usage.total_output_tokens,
  thought: 0,
};

/** A user that is allowed to give credits, and the one it gives them to. */
async function pair() {
  const granter = await t.signIn();
  await t.give(granter.id, ['ai_credits.grant']);
  return { granter, student: await t.signIn() };
}
const grant = (cookie: string, userId: number, body: unknown) =>
  t.call('POST', `/admin/users/${userId}/credits`, cookie, body);
const balanceOf = async (userId: number) => credits.balance(userId);

describe('the rules the database holds for each kind of credit', () => {
  const insert = (cols: Record<string, unknown>) => {
    const keys = Object.keys(cols);
    return q(
      `INSERT INTO ai_credit_grant (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      keys.map((k) => cols[k]),
    );
  };
  const code = (p: Promise<unknown>) =>
    p.then(
      () => 'ok',
      (e: { code?: string }) => e.code,
    );

  it('needs, for an admin grant, a positive amount from somebody else', async () => {
    const { granter, student } = await pair();
    expect(
      await code(
        insert({
          userId: student.id,
          kind: 1,
          amount: 10,
          grantedByUserId: granter.id,
        }),
      ),
    ).toBe('ok');
    expect(
      await code(insert({ userId: student.id, kind: 1, amount: 10 })),
    ).toBe('23514');
    expect(
      await code(
        insert({
          userId: student.id,
          kind: 1,
          amount: 10,
          grantedByUserId: student.id,
        }),
      ),
    ).toBe('23514');
    expect(
      await code(
        insert({
          userId: student.id,
          kind: 1,
          amount: -10,
          grantedByUserId: granter.id,
        }),
      ),
    ).toBe('23514');
    expect(
      await code(
        insert({
          userId: student.id,
          kind: 1,
          amount: 0,
          grantedByUserId: granter.id,
        }),
      ),
    ).toBe('23514');
  });

  it('needs, for a purchase, the payment it came from', async () => {
    const { student } = await pair();
    expect(
      await code(insert({ userId: student.id, kind: 2, amount: 10 })),
    ).toBe('23514');
    expect(
      await code(
        insert({
          userId: student.id,
          kind: 2,
          amount: 10,
          externalRef: 'pay_1',
        }),
      ),
    ).toBe('ok');
  });

  it('is the system’s, once a day for each user, for a daily allowance', async () => {
    const { granter, student } = await pair();
    expect(
      await code(
        insert({
          userId: student.id,
          kind: 3,
          amount: 3,
          grantedByUserId: granter.id,
        }),
      ),
    ).toBe('23514');
    expect(await code(insert({ userId: student.id, kind: 3, amount: 3 }))).toBe(
      'ok',
    );
    expect(await code(insert({ userId: student.id, kind: 3, amount: 3 }))).toBe(
      '23505',
    );
    const other = await t.signIn();
    expect(await code(insert({ userId: other.id, kind: 3, amount: 3 }))).toBe(
      'ok',
    );
    expect(
      await code(
        insert({
          userId: student.id,
          kind: 3,
          amount: 3,
          createdAt: new Date(Date.now() - 36 * 3600 * 1000),
        }),
      ),
    ).toBe('ok');
  });

  it('is negative and points at one grant, once, for a reversal, and only a reversal points', async () => {
    const { granter, student } = await pair();
    const [{ id }] = await insert({
      userId: student.id,
      kind: 1,
      amount: 10,
      grantedByUserId: granter.id,
    });
    expect(
      await code(
        insert({
          userId: student.id,
          kind: 4,
          amount: 10,
          grantedByUserId: granter.id,
          reversesGrantId: id,
        }),
      ),
    ).toBe('23514');
    expect(
      await code(
        insert({
          userId: student.id,
          kind: 4,
          amount: -10,
          grantedByUserId: granter.id,
        }),
      ),
    ).toBe('23514');
    expect(
      await code(
        insert({
          userId: student.id,
          kind: 1,
          amount: 5,
          grantedByUserId: granter.id,
          reversesGrantId: id,
        }),
      ),
    ).toBe('23514');
    expect(
      await code(
        insert({
          userId: student.id,
          kind: 4,
          amount: -10,
          grantedByUserId: granter.id,
          reversesGrantId: id,
        }),
      ),
    ).toBe('ok');
    expect(
      await code(
        insert({
          userId: student.id,
          kind: 4,
          amount: -10,
          grantedByUserId: granter.id,
          reversesGrantId: id,
        }),
      ),
    ).toBe('23505');
  });

  it('knows no other kind', async () => {
    const { granter, student } = await pair();
    expect(
      await code(
        insert({
          userId: student.id,
          kind: 5,
          amount: 10,
          grantedByUserId: granter.id,
        }),
      ),
    ).toBe('23514');
  });
});

describe('what a model costs', () => {
  it('seeds the prices the cost spec relies on, and the doubling of the 3.8 flash on 2027-01-01', async () => {
    const rows = await q(
      `SELECT model, "inputNanoUsd" AS i, "cachedNanoUsd" AS c, "outputNanoUsd" AS o, "effectiveFrom"::date::text AS d FROM ai_model_price ORDER BY model, "effectiveFrom"`,
    );
    const of = (model: string, d: string) =>
      rows.find((r) => r.model === model && r.d === d);
    expect(of('gemini-3.5-flash-lite', '2026-01-01')).toMatchObject({
      i: 300,
      c: 30,
      o: 2500,
    });
    expect(of('gemini-3.1-flash-lite', '2026-01-01')).toMatchObject({
      i: 250,
      c: 25,
      o: 1500,
    });
    expect(of('gemini-4-hydrogen', '2026-01-01')).toMatchObject({
      i: 1500,
      c: 75,
      o: 7500,
    });
    expect(of('gemini-3.8-flash', '2026-01-01')).toMatchObject({
      i: 750,
      o: 3750,
    });
    expect(of('gemini-3.8-flash', '2027-01-01')).toMatchObject({
      i: 1500,
      o: 7500,
    });
  });

  it('takes the price in force now, and refuses a model with none rather than bill it at zero', async () => {
    expect((await usage.price('gemini-3.5-flash-lite')).inputNanoUsd).toBe(300);
    await expect(usage.price(`nobody-${t.run}`)).rejects.toBeInstanceOf(
      NoPriceError,
    );
    const future = `test-future ${t.run}`;
    await q(
      `INSERT INTO ai_model_price (model, "inputNanoUsd", "cachedNanoUsd", "outputNanoUsd", "effectiveFrom") VALUES ($1, 1, 0, 1, now() + interval '1 day')`,
      [future],
    );
    await expect(usage.price(future)).rejects.toBeInstanceOf(NoPriceError);
    await q(
      `INSERT INTO ai_model_price (model, "inputNanoUsd", "cachedNanoUsd", "outputNanoUsd", "effectiveFrom") VALUES ($1, 7, 0, 9, now() - interval '1 day'), ($1, 70, 0, 90, now() + interval '1 day')`,
      [future],
    );
    expect(await usage.price(future)).toMatchObject({
      inputNanoUsd: 7,
      outputNanoUsd: 9,
    });
  });
});

describe('granting and reversing credits', () => {
  it('answers 401 without a session and 403 without the permission', async () => {
    const { student } = await pair();
    expect(
      (await grant('', student.id, { amount: 5, reason: 'x' })).status,
    ).toBe(401);
    const nobody = await t.signIn();
    expect(
      (await grant(nobody.cookie, student.id, { amount: 5, reason: 'x' }))
        .status,
    ).toBe(403);
  });

  it('gives credits, which are the balance, and shows them to the admin with who gave them', async () => {
    const { granter, student } = await pair();
    expect(await balanceOf(student.id)).toBe(0);
    const res = await grant(granter.cookie, student.id, {
      amount: 120,
      reason: 'welcome',
    });
    expect(res.status).toBe(201);
    const g = await json<{
      id: string;
      kind: number;
      amount: number;
      grantedByUserId: number;
    }>(res);
    expect(g).toMatchObject({
      kind: 1,
      amount: 120,
      grantedByUserId: granter.id,
    });
    expect(await balanceOf(student.id)).toBe(120);
    const viewer = await t.signIn();
    await t.give(viewer.id, ['users.view']);
    const summary = await json<{
      balance: number;
      grants: { reason: string }[];
    }>(
      await t.call('GET', `/admin/users/${student.id}/credits`, viewer.cookie),
    );
    expect(summary.balance).toBe(120);
    expect(summary.grants[0].reason).toBe('welcome');
    const users = await json<{ items: { id: number; balance: number }[] }>(
      await t.call('GET', `/admin/users?q=${t.run}`, viewer.cookie),
    );
    expect(users.items.find((u) => u.id === student.id)!.balance).toBe(120);
  });

  it('refuses a grant to oneself, above the ceiling, of nothing, with no reason, or to nobody', async () => {
    const { granter, student } = await pair();
    expect(
      (await grant(granter.cookie, granter.id, { amount: 5, reason: 'me' }))
        .status,
    ).toBe(400);
    expect(
      (
        await grant(granter.cookie, student.id, {
          amount: 5001,
          reason: 'too much',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await grant(granter.cookie, student.id, {
          amount: 5000,
          reason: 'the most',
        })
      ).status,
    ).toBe(201);
    expect(
      (await grant(granter.cookie, student.id, { amount: 0, reason: 'x' }))
        .status,
    ).toBe(400);
    expect(
      (await grant(granter.cookie, student.id, { amount: -5, reason: 'x' }))
        .status,
    ).toBe(400);
    expect(
      (await grant(granter.cookie, student.id, { amount: 1.5, reason: 'x' }))
        .status,
    ).toBe(400);
    expect(
      (await grant(granter.cookie, student.id, { amount: 5 })).status,
    ).toBe(400);
    expect(
      (
        await grant(granter.cookie, student.id, {
          amount: 5,
          reason: 'x',
          userId: 1,
        })
      ).status,
    ).toBe(400);
    expect(
      (await grant(granter.cookie, 2147483000, { amount: 5, reason: 'x' }))
        .status,
    ).toBe(404);
    expect(await balanceOf(student.id)).toBe(5000);
  });

  it('reverses a grant whole, once, with its own permission, and a reversal is not reversed', async () => {
    const { granter, student } = await pair();
    const g = await json<{ id: string }>(
      await grant(granter.cookie, student.id, { amount: 80, reason: 'oops' }),
    );
    const reverse = (
      cookie: string,
      id: string,
      body: unknown = { reason: 'wrong person' },
    ) => t.call('POST', `/admin/credits/${id}/reverse`, cookie, body);
    expect((await reverse(granter.cookie, g.id)).status).toBe(403);
    const reverser = await t.signIn();
    await t.give(reverser.id, ['ai_credits.reverse']);
    expect((await reverse(reverser.cookie, 'not-a-uuid')).status).toBe(400);
    expect(
      (await reverse(reverser.cookie, '0198a0a0-0000-7000-8000-000000000000'))
        .status,
    ).toBe(404);
    expect((await reverse(reverser.cookie, g.id, {})).status).toBe(400);
    const done = await reverse(reverser.cookie, g.id);
    expect(done.status).toBe(201);
    const r = await json<{
      id: string;
      kind: number;
      amount: number;
      reversesGrantId: string;
    }>(done);
    expect(r).toMatchObject({ kind: 4, amount: -80, reversesGrantId: g.id });
    expect(await balanceOf(student.id)).toBe(0);
    expect((await reverse(reverser.cookie, g.id)).status).toBe(409);
    expect((await reverse(reverser.cookie, r.id)).status).toBe(400);
    expect(await balanceOf(student.id)).toBe(0);
  });

  it('writes the grant and the reversal to the audit trail, with who did it', async () => {
    const { granter, student } = await pair();
    const g = await json<{ id: string }>(
      await grant(granter.cookie, student.id, {
        amount: 7,
        reason: 'audit me',
      }),
    );
    await credits.reverse(granter.id, g.id, 'and back');
    const rows = await q(
      `SELECT action, detail FROM admin_audit_event WHERE "actorUserId" = $1 AND "targetUserId" = $2 ORDER BY "createdAt", id`,
      [granter.id, student.id],
    );
    expect(rows.map((r) => r.action)).toEqual([
      'credit.grant',
      'credit.reverse',
    ]);
    expect(rows[0].detail).toMatchObject({ amount: 7, reason: 'audit me' });
  });

  it('lets only an admin change what a role may spend in a day, and only with the permission to grant', async () => {
    const manager = await t.signIn();
    await t.give(manager.id, ['roles.manage', 'users.view']);
    const admin = await t.signIn('admin');
    const made = await t.call('POST', '/admin/roles', admin.cookie, {
      name: `limited ${t.run}`,
      permissions: ['ai.use'],
      aiDailyCreditLimit: 40,
    });
    expect(made.status).toBe(201);
    const role = await json<{ id: number; aiDailyCreditLimit: number }>(made);
    expect(role.aiDailyCreditLimit).toBe(40);
    expect(
      (
        await t.call('PUT', `/admin/roles/${role.id}`, manager.cookie, {
          permissions: ['ai.use'],
          aiDailyCreditLimit: 400,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await t.call('POST', '/admin/roles', manager.cookie, {
          name: `limited2 ${t.run}`,
          permissions: ['users.view'],
          aiDailyCreditLimit: 5,
        })
      ).status,
    ).toBe(403);
    const raised = await t.call(
      'PUT',
      `/admin/roles/${role.id}`,
      admin.cookie,
      { permissions: ['ai.use'], aiDailyCreditLimit: 90 },
    );
    expect(
      (await json<{ aiDailyCreditLimit: number }>(raised)).aiDailyCreditLimit,
    ).toBe(90);
    expect(
      (
        await t.call('PUT', `/admin/roles/${role.id}`, admin.cookie, {
          permissions: ['ai.use'],
          aiDailyCreditLimit: -1,
        })
      ).status,
    ).toBe(400);
  });

  it('shows the platform spend in US$ to an admin only', async () => {
    const admin = await t.signIn('admin');
    const view = await json<{
      day: { spentUsd: number; budgetUsd: number };
      month: { budgetUsd: number };
    }>(await t.call('GET', '/admin/ai/budget', admin.cookie));
    expect(view.day.budgetUsd).toBe(Number(env.daily ?? 2));
    expect(view.month.budgetUsd).toBe(Number(env.monthly ?? 20));
    expect(
      (await t.call('GET', '/admin/ai/budget', (await t.signIn()).cookie))
        .status,
    ).toBe(403);
  });
});

describe('one question at a time, and what it costs', () => {
  const MODEL = 'gemini-3.5-flash-lite';

  it('opens a pending row, refuses a second while it is open, and bills what the API reported when it closes', async () => {
    const { granter, student } = await pair();
    await grant(granter.cookie, student.id, { amount: 100, reason: 'q' });
    const first = await usage.begin(student.id, MODEL);
    await expect(usage.begin(student.id, MODEL)).rejects.toBeInstanceOf(
      ConflictException,
    );
    const done = await usage.finish(first.id, 'ok', asUsage, first.price, {
      total_tokens: 66,
    });
    expect(done).toEqual({ costNanoUsd: 21 * 300 + 45 * 2500, credits: 2 });
    expect(await balanceOf(student.id)).toBe(98);
    const [row] = await q(
      `SELECT status, "inputTokens", "outputTokens", "costNanoUsd"::text AS cost, "usageRaw" FROM ai_usage WHERE id = $1`,
      [first.id],
    );
    expect(row).toMatchObject({
      status: 'ok',
      inputTokens: 21,
      outputTokens: 45,
      cost: '118800',
      usageRaw: { total_tokens: 66 },
    });
    const second = await usage.begin(student.id, MODEL);
    expect(second.id).not.toBe(first.id);
  });

  it('lets two students ask at once, and of two questions at once from one student lets exactly one through', async () => {
    const a = await t.signIn();
    const b = await t.signIn();
    const results = await Promise.allSettled([
      usage.begin(a.id, MODEL),
      usage.begin(b.id, MODEL),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    const c = await t.signIn();
    const race = await Promise.allSettled([
      usage.begin(c.id, MODEL),
      usage.begin(c.id, MODEL),
      usage.begin(c.id, MODEL),
    ]);
    expect(race.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('stops a question that died (a replica fell) from blocking the student for good', async () => {
    const s = await t.signIn();
    const dead = await usage.begin(s.id, MODEL);
    await q(
      `UPDATE ai_usage SET "createdAt" = now() - interval '3 minutes' WHERE id = $1`,
      [dead.id],
    );
    await expect(usage.begin(s.id, MODEL)).resolves.toBeTruthy();
    expect(
      (await q(`SELECT status FROM ai_usage WHERE id = $1`, [dead.id]))[0]
        .status,
    ).toBe('error');
  });

  it('bills a question cut off, which Google still charged, and bills nothing for one that reported no tokens', async () => {
    const s = await t.signIn();
    const cut = fixtures.usage[2];
    const o = await usage.begin(s.id, MODEL);
    const billed = await usage.finish(
      o.id,
      'incomplete',
      {
        input: cut.usage.total_input_tokens,
        cached: 0,
        output: cut.usage.total_output_tokens,
        thought: 0,
      },
      o.price,
      null,
    );
    expect(billed.credits).toBeGreaterThan(0);
    const e = await usage.begin(s.id, MODEL);
    expect(await usage.finish(e.id, 'error', null, e.price, null)).toEqual({
      costNanoUsd: 0,
      credits: 0,
    });
  });

  it('refuses a model with no price before it writes anything', async () => {
    const s = await t.signIn();
    await expect(usage.begin(s.id, `nobody-${t.run}`)).rejects.toBeInstanceOf(
      NoPriceError,
    );
    expect(
      await q(`SELECT 1 FROM ai_usage WHERE "userId" = $1`, [s.id]),
    ).toHaveLength(0);
  });

  it('keeps the bill when a conversation is erased: the usage row loses its conversation and stays', async () => {
    const s = await t.signIn();
    const [{ id: conversationId }] = await q(
      `INSERT INTO kurz_conversation ("userId", "topicKey", lang) VALUES ($1, 'concept-read:test', 'en') RETURNING id`,
      [s.id],
    );
    const o = await usage.begin(s.id, MODEL, conversationId as string);
    await usage.finish(o.id, 'ok', asUsage, o.price, null);
    const row = () =>
      q(`SELECT "conversationId", credits FROM ai_usage WHERE id = $1`, [o.id]);
    expect((await row())[0].conversationId).toBe(conversationId);
    await q(`DELETE FROM kurz_conversation WHERE id = $1`, [conversationId]);
    const [after] = await row();
    expect(after.conversationId).toBeNull();
    expect(after.credits).toBeGreaterThan(0);
    expect(await credits.balance(s.id)).toBe(-after.credits);
  });

  it('refuses a conversation that does not exist, instead of billing something nobody can find', async () => {
    const s = await t.signIn();
    await expect(
      usage.begin(s.id, MODEL, '0198a0a0-0000-7000-8000-000000000001'),
    ).rejects.toMatchObject({ code: '23503' });
  });
});

describe('may this student ask now', () => {
  /** Spends `nano` of the platform’s money (and `credits` of the student’s) at a moment. */
  const spend = (
    userId: number,
    nano: number,
    credits = 0,
    ago = '0 seconds',
  ) =>
    q(
      `INSERT INTO ai_usage ("userId", model, status, "costNanoUsd", credits, "createdAt") VALUES ($1, 'gemini-3.5-flash-lite', 'ok', $2, $3, now() - $4::interval)`,
      [userId, nano, credits, ago],
    );
  const roomy = () => {
    process.env.KURZ_PLATFORM_BUDGET_DAILY_USD = '1000000';
    process.env.KURZ_PLATFORM_BUDGET_MONTHLY_USD = '1000000';
  };
  /** A student with balance whose only role is one with `limit` credits a day. */
  async function limited(limit: number, balance = 1000) {
    const { granter, student } = await pair();
    await grant(granter.cookie, student.id, {
      amount: balance,
      reason: 'room',
    });
    await q(
      `DELETE FROM user_role WHERE "userId" = $1 AND "roleId" = (SELECT id FROM role WHERE name = 'student')`,
      [student.id],
    );
    const [{ id }] = await q(
      `INSERT INTO role (name, "aiDailyCreditLimit") VALUES ($1, $2) RETURNING id`,
      [`cap${limit} ${student.id} ${t.run}`, limit],
    );
    await q(`INSERT INTO user_role ("userId", "roleId") VALUES ($1, $2)`, [
      student.id,
      id,
    ]);
    return student;
  }

  it('says there is no balance to a student nobody has given credits, and nothing once they have some', async () => {
    roomy();
    const { granter, student } = await pair();
    expect(await access.check(student.id)).toEqual({
      reason: 'NO_BALANCE',
      resetsAt: null,
    });
    await grant(granter.cookie, student.id, { amount: 50, reason: 'go' });
    expect(await access.check(student.id)).toBeNull();
    await spend(student.id, 0, 50);
    expect(await access.check(student.id)).toMatchObject({
      reason: 'NO_BALANCE',
    });
  });

  it('stops everybody, whatever they hold, when the platform has spent its month, and says when it is back', async () => {
    const { granter, student } = await pair();
    await grant(granter.cookie, student.id, { amount: 500, reason: 'rich' });
    await spend(student.id, 10);
    process.env.KURZ_PLATFORM_BUDGET_DAILY_USD = '1000000';
    process.env.KURZ_PLATFORM_BUDGET_MONTHLY_USD = '0.000000001';
    const now = new Date('2026-11-14T10:00:00Z');
    expect(await access.check(student.id, now)).toEqual({
      reason: 'PLATFORM_BUDGET_MONTHLY',
      resetsAt: '2026-12-01T00:00:00.000Z',
    });
  });

  it('stops everybody for the rest of the day when the day is spent but the month is not', async () => {
    const { granter, student } = await pair();
    await grant(granter.cookie, student.id, { amount: 500, reason: 'rich' });
    await spend(student.id, 10);
    process.env.KURZ_PLATFORM_BUDGET_MONTHLY_USD = '1000000';
    process.env.KURZ_PLATFORM_BUDGET_DAILY_USD = '0.000000001';
    expect(
      await access.check(student.id, new Date('2026-11-14T10:00:00Z')),
    ).toEqual({
      reason: 'PLATFORM_BUDGET_DAILY',
      resetsAt: '2026-11-15T00:00:00.000Z',
    });
  });

  it('reports the month before the day, and the platform before the student’s own limit and balance', async () => {
    const student = await limited(5);
    await spend(student.id, 10, 5);
    process.env.KURZ_PLATFORM_BUDGET_DAILY_USD = '0.000000001';
    process.env.KURZ_PLATFORM_BUDGET_MONTHLY_USD = '0.000000001';
    expect((await access.check(student.id))?.reason).toBe(
      'PLATFORM_BUDGET_MONTHLY',
    );
    process.env.KURZ_PLATFORM_BUDGET_MONTHLY_USD = '1000000';
    expect((await access.check(student.id))?.reason).toBe(
      'PLATFORM_BUDGET_DAILY',
    );
    roomy();
    expect((await access.check(student.id))?.reason).toBe('USER_DAILY_LIMIT');
  });

  it('holds a student to the limit of their roles over any 24 hours, and frees it when the oldest spending ages out', async () => {
    roomy();
    const student = await limited(10);
    await spend(student.id, 0, 100, '25 hours');
    expect(await access.check(student.id)).toBeNull();
    await spend(student.id, 0, 10, '1 hour');
    const blocked = await access.check(student.id);
    expect(blocked?.reason).toBe('USER_DAILY_LIMIT');
    const frees = new Date(blocked!.resetsAt!).getTime();
    expect(Math.abs(frees - (Date.now() + 23 * 3600 * 1000))).toBeLessThan(
      60_000,
    );
  });

  it('gives a student the largest limit among their roles, and none at all when no role has one', async () => {
    roomy();
    const student = await limited(10);
    const [{ id }] = await q(
      `INSERT INTO role (name, "aiDailyCreditLimit") VALUES ($1, 50) RETURNING id`,
      [`cap50 ${student.id} ${t.run}`],
    );
    await q(`INSERT INTO user_role ("userId", "roleId") VALUES ($1, $2)`, [
      student.id,
      id,
    ]);
    expect(await access.dailyLimit(student.id)).toBe(50);
    await spend(student.id, 0, 30);
    expect(await access.check(student.id)).toBeNull();
    await q(`DELETE FROM user_role WHERE "userId" = $1`, [student.id]);
    expect(await access.dailyLimit(student.id)).toBe(0);
    expect((await access.check(student.id))?.reason).toBe('USER_DAILY_LIMIT');
  });

  it('gives a plain student the seeded limit of 300 credits', async () => {
    const s = await t.signIn();
    expect(await access.dailyLimit(s.id)).toBe(300);
  });

  it('shows the student where they stand, and the platform only as a percent', async () => {
    const student = await limited(10, 200);
    await spend(student.id, 0, 4);
    process.env.KURZ_PLATFORM_BUDGET_DAILY_USD = '1000000';
    process.env.KURZ_PLATFORM_BUDGET_MONTHLY_USD = '1000000';
    const s = await access.status(student.id);
    expect(s).toMatchObject({
      balance: 196,
      dailyLimit: 10,
      usedLast24h: 4,
      blocked: null,
    });
    expect(Object.keys(s.platformBudget).sort()).toEqual([
      'period',
      'resetsAt',
      'usedPercent',
    ]);
    expect(s.platformBudget.usedPercent).toBe(0);
    process.env.KURZ_PLATFORM_BUDGET_MONTHLY_USD = '0.000000001';
    const full = await access.status(student.id);
    expect(full.platformBudget).toMatchObject({
      period: 'month',
      usedPercent: 100,
    });
    expect(full.blocked?.reason).toBe('PLATFORM_BUDGET_MONTHLY');
    expect(JSON.stringify(full)).not.toMatch(/usd|nano/i);
  });

  it('adds up the platform spend of a UTC day and month in real dollars, from all students', async () => {
    const a = await t.signIn();
    const before = await budget.spent();
    await spend(a.id, 1_500_000);
    await spend(a.id, 500_000, 0, '3 days');
    const after = await budget.spent();
    expect(after.day - before.day).toBeGreaterThanOrEqual(1_500_000);
    expect(after.month - before.month).toBeGreaterThanOrEqual(1_500_000);
  });
});
