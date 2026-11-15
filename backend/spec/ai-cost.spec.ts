import { describe, expect, it } from 'vitest';
import {
  costNanoUsd,
  creditsFor,
  maxGrantCredits,
  nextUtcDay,
  nextUtcMonth,
  percentUsed,
  platformBudgetUsd,
} from '../src/ai/ai-cost';
import fixtures from './fixtures/gemini-usage.json';

/** What each model costs per token in nano-US$, as `ai_model_price` seeds it (a spec in ai-credits checks that). */
const PRICE = {
  'gemini-3.5-flash-lite': {
    inputNanoUsd: 300,
    cachedNanoUsd: 30,
    outputNanoUsd: 2500,
  },
  'gemini-3.1-flash-lite': {
    inputNanoUsd: 250,
    cachedNanoUsd: 25,
    outputNanoUsd: 1500,
  },
  'gemini-4-hydrogen': {
    inputNanoUsd: 1500,
    cachedNanoUsd: 75,
    outputNanoUsd: 7500,
  },
} as const;
type Model = keyof typeof PRICE;

const asUsage = (u: (typeof fixtures.usage)[number]['usage']) => ({
  input: u.total_input_tokens,
  cached: u.total_cached_tokens,
  output: u.total_output_tokens,
  thought: u.total_thought_tokens,
});

describe('the cost of a question', () => {
  it('is whole nano-US$, with the input, the cache and the output (thinking included) at their own prices', () => {
    const p = PRICE['gemini-3.5-flash-lite'];
    expect(
      costNanoUsd({ input: 1000, cached: 0, output: 100, thought: 0 }, p),
    ).toBe(1000 * 300 + 100 * 2500);
    expect(
      costNanoUsd({ input: 1000, cached: 400, output: 100, thought: 50 }, p),
    ).toBe(600 * 300 + 400 * 30 + 150 * 2500);
  });

  it('never bills a cache hit larger than the input, nor a negative count', () => {
    const p = PRICE['gemini-3.5-flash-lite'];
    expect(
      costNanoUsd({ input: 100, cached: 900, output: 0, thought: 0 }, p),
    ).toBe(100 * 30);
    expect(
      costNanoUsd({ input: -5, cached: -1, output: -2, thought: -3 }, p),
    ).toBe(0);
  });

  it('rounds up to a whole credit once, so a question is never free and never billed twice', () => {
    expect(creditsFor(0)).toBe(0);
    expect(creditsFor(1)).toBe(1);
    expect(creditsFor(100_000)).toBe(1);
    expect(creditsFor(100_001)).toBe(2);
    // two calls of one question (a retry) round once, not each
    expect(creditsFor(60_000 + 60_000)).toBe(2);
    expect(creditsFor(60_000) + creditsFor(60_000)).toBe(2);
    expect(creditsFor(30_000 + 30_000)).toBe(1);
    expect(creditsFor(30_000) + creditsFor(30_000)).toBe(2);
  });
});

describe('what the Gemini API really reported (recorded fixtures)', () => {
  it('has the fields the cost needs, and the total is input + output + thinking', () => {
    expect(fixtures.usage.length).toBeGreaterThanOrEqual(6);
    for (const f of fixtures.usage) {
      const u = f.usage;
      expect(u.total_tokens, f.what).toBe(
        u.total_input_tokens + u.total_output_tokens + u.total_thought_tokens,
      );
      expect(u.total_cached_tokens, f.what).toBeLessThanOrEqual(
        u.total_input_tokens,
      );
    }
  });

  it('prices every recorded question, none of them free', () => {
    for (const f of fixtures.usage) {
      const nano = costNanoUsd(asUsage(f.usage), PRICE[f.model as Model]);
      expect(nano, f.what).toBeGreaterThan(0);
      expect(creditsFor(nano), f.what).toBeGreaterThanOrEqual(1);
    }
  });

  it('costs the short answer 2 credits, as worked by hand: 21 in and 45 out on the 3.5 flash-lite', () => {
    const f = fixtures.usage[0];
    expect(costNanoUsd(asUsage(f.usage), PRICE['gemini-3.5-flash-lite'])).toBe(
      21 * 300 + 45 * 2500,
    );
    expect(creditsFor(21 * 300 + 45 * 2500)).toBe(2);
  });

  it('bills the thinking: it is the larger part of the high-thinking question', () => {
    const f = fixtures.usage[1];
    expect(f.usage.total_thought_tokens).toBeGreaterThan(
      f.usage.total_output_tokens,
    );
    const withThinking = costNanoUsd(
      asUsage(f.usage),
      PRICE['gemini-3.5-flash-lite'],
    );
    const without = costNanoUsd(
      { ...asUsage(f.usage), thought: 0 },
      PRICE['gemini-3.5-flash-lite'],
    );
    expect(withThinking).toBeGreaterThan(without);
  });

  it('keeps billing a question cut off by max_output_tokens, which the API still charges', () => {
    const cut = fixtures.usage.filter((f) => f.status === 'incomplete');
    expect(cut.length).toBe(2);
    for (const f of cut)
      expect(
        creditsFor(costNanoUsd(asUsage(f.usage), PRICE[f.model as Model])),
      ).toBeGreaterThan(0);
  });

  it('has not seen a cache hit yet, so the cache price is a guess until one is recorded', () => {
    // ponytail: if this fails, a hit was recorded: check that `input` includes `cached` before trusting the formula.
    expect(fixtures.usage.every((f) => f.usage.total_cached_tokens === 0)).toBe(
      true,
    );
  });

  it('knows the shape of the errors the API answers with', () => {
    for (const e of fixtures.errors)
      expect(typeof e.body.error.code).toBe('string');
  });
});

describe('the platform budget windows and settings', () => {
  it('resets at the next UTC midnight, and on the first of the next UTC month', () => {
    const now = new Date('2026-11-14T23:59:59Z');
    expect(nextUtcDay(now).toISOString()).toBe('2026-11-15T00:00:00.000Z');
    expect(nextUtcMonth(now).toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(nextUtcDay(new Date('2026-12-31T10:00:00Z')).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
    expect(nextUtcMonth(new Date('2026-12-31T10:00:00Z')).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
    expect(nextUtcMonth(new Date('2026-01-31T10:00:00Z')).toISOString()).toBe(
      '2026-02-01T00:00:00.000Z',
    );
  });

  it('reads the budgets in US$ from the environment, and falls back to US$ 2 a day and US$ 20 a month', () => {
    expect(platformBudgetUsd({})).toEqual({ daily: 2, monthly: 20 });
    expect(
      platformBudgetUsd({
        KURZ_PLATFORM_BUDGET_DAILY_USD: '0.5',
        KURZ_PLATFORM_BUDGET_MONTHLY_USD: '9',
      }),
    ).toEqual({ daily: 0.5, monthly: 9 });
    expect(
      platformBudgetUsd({
        KURZ_PLATFORM_BUDGET_DAILY_USD: 'abc',
        KURZ_PLATFORM_BUDGET_MONTHLY_USD: '-3',
      }),
    ).toEqual({ daily: 2, monthly: 20 });
  });

  it('shows the share spent as a whole percent that never passes 100', () => {
    expect(percentUsed(0, 2)).toBe(0);
    expect(percentUsed(1e9, 2)).toBe(50);
    expect(percentUsed(1.999e9, 2)).toBe(99);
    expect(percentUsed(5e9, 2)).toBe(100);
  });

  it('caps one grant at 5000 credits unless told otherwise', () => {
    expect(maxGrantCredits({})).toBe(5000);
    expect(maxGrantCredits({ AI_CREDIT_MAX_GRANT: '120' })).toBe(120);
    expect(maxGrantCredits({ AI_CREDIT_MAX_GRANT: '0' })).toBe(5000);
  });
});
