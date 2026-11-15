/** The model that answers when `KURZ_MODEL` is not set. Chosen by the eval (#317); it needs a row in `ai_model_price`. */
export const KURZ_DEFAULT_MODEL = 'gemini-3.5-flash-lite';

/**
 * The version of the privacy notice and 18+ confirmation the student accepts before the first question. Bump it
 * when the text of the privacy page changes: everyone confirms again. Not an env: it travels with the text.
 */
export const KURZ_TERMS_VERSION = '1';

/** The kill switch of the whole assistant. Off unless `KURZ_ENABLED=1`: a deploy never starts spending by accident. */
export const kurzEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.KURZ_ENABLED === '1';

/** The stand-in model for the specs. Never in production: see `assertFakeModelAllowed`. */
export const fakeModelRequested = (
  env: NodeJS.ProcessEnv = process.env,
): boolean => env.KURZ_FAKE_MODEL === '1';

/**
 * Unlike the dev login (which production simply does not serve), a fake model in production would answer
 * students with canned text, so the boot fails instead of ignoring the flag.
 */
export function assertFakeModelAllowed(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (fakeModelRequested(env) && env.NODE_ENV === 'production')
    throw new Error('KURZ_FAKE_MODEL must not be set in production');
}

const intEnv = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export interface KurzSettings {
  model: string;
  /** `minimal`, `low`, `medium` or `high`. The 3.8 Flash does not take `minimal`: change it with the model. */
  thinkingLevel: string;
  /** Includes the thinking tokens: a model that thinks too long is cut off, and still billed. */
  maxOutputTokens: number;
  timeoutMs: number;
  /** Related posts read as sources, besides the post itself. */
  maxRelated: number;
  /** Earlier exchanges of the conversation the model gets as context. */
  historyTurns: number;
}

export function kurzSettings(
  env: NodeJS.ProcessEnv = process.env,
): KurzSettings {
  return {
    model: env.KURZ_MODEL || KURZ_DEFAULT_MODEL,
    thinkingLevel: env.KURZ_THINKING_LEVEL || 'minimal',
    maxOutputTokens: intEnv(env.KURZ_MAX_OUTPUT_TOKENS, 1500),
    timeoutMs: intEnv(env.KURZ_TIMEOUT_MS, 30_000),
    maxRelated: 4,
    historyTurns: 2,
  };
}

/** How long a conversation is kept after its last message. */
export const KURZ_RETENTION_DAYS = 90;

/** Limits of what a student sends. */
export const MAX_QUESTION_CHARS = 500;
export const MAX_SELECTION_CHARS = 2000;
