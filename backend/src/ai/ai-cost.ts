/** Where a credit came from; the number is what `ai_credit_grant.kind` stores. */
export enum AiCreditKind {
  ADMIN_GRANT = 1,
  PURCHASE = 2,
  DAILY_ALLOWANCE = 3,
  REVERSAL = 4,
}

/** What the model API reports for one question: the tokens of `usage`. */
export interface ModelUsage {
  input: number;
  cached: number;
  output: number;
  /** Thinking tokens: reported apart from the output, and billed at the output price. */
  thought: number;
}

/** What a model costs per token, in nano-US$ (1e-9). US$ per 1M tokens x 1000. */
export interface ModelPrice {
  inputNanoUsd: number;
  cachedNanoUsd: number;
  outputNanoUsd: number;
}

/** A credit is US$ 0.0001. */
export const NANO_USD_PER_CREDIT = 100_000;

/**
 * The cost of one question in whole nano-US$, with no float in it. The cached tokens are part of the input
 * (the docs do not say so outright, so `cached` is capped at `input`: the worst a wrong guess does is bill a
 * cache hit at the input price it would have had anyway) and are billed at the cache price.
 */
export function costNanoUsd(usage: ModelUsage, price: ModelPrice): number {
  const input = Math.max(0, Math.trunc(usage.input));
  const cached = Math.min(Math.max(0, Math.trunc(usage.cached)), input);
  const out =
    Math.max(0, Math.trunc(usage.output)) +
    Math.max(0, Math.trunc(usage.thought));
  return (
    (input - cached) * price.inputNanoUsd +
    cached * price.cachedNanoUsd +
    out * price.outputNanoUsd
  );
}

/** Credits for a cost, rounded up once for the whole question, so a retry's cost is added before the round. */
export const creditsFor = (nanoUsd: number): number =>
  Math.ceil(nanoUsd / NANO_USD_PER_CREDIT);

/** Why a question is not allowed, in the order the checks run: the one that touches everybody comes first. */
export const AI_BLOCK_REASONS = [
  'PLATFORM_BUDGET_MONTHLY',
  'PLATFORM_BUDGET_DAILY',
  'USER_DAILY_LIMIT',
  'NO_BALANCE',
] as const;
export type AiBlockReason = (typeof AI_BLOCK_REASONS)[number];

/** `resetsAt` is when it can work again (ISO), or null when only an admin can change that (no balance). */
export interface AiBlock {
  reason: AiBlockReason;
  resetsAt: string | null;
}

/** The first UTC midnight after `now`. */
export const nextUtcDay = (now: Date): Date =>
  new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );

/** The first day of the next UTC month after `now`. */
export const nextUtcMonth = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

const positive = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** The platform budget in US$ (`KURZ_PLATFORM_BUDGET_DAILY_USD`, `KURZ_PLATFORM_BUDGET_MONTHLY_USD`). */
export const platformBudgetUsd = (env: NodeJS.ProcessEnv = process.env) => ({
  daily: positive(env.KURZ_PLATFORM_BUDGET_DAILY_USD, 2),
  monthly: positive(env.KURZ_PLATFORM_BUDGET_MONTHLY_USD, 20),
});

/** The most credits one grant may give (`AI_CREDIT_MAX_GRANT`). */
export const maxGrantCredits = (env: NodeJS.ProcessEnv = process.env): number =>
  Math.trunc(positive(env.AI_CREDIT_MAX_GRANT, 5000));

/** How much of a budget is spent, as a whole percent that never shows above 100. */
export const percentUsed = (spentNanoUsd: number, budgetUsd: number): number =>
  Math.min(100, Math.floor((spentNanoUsd / (budgetUsd * 1e9)) * 100));
