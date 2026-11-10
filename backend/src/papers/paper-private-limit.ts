const DEFAULT_MAX_PRIVATE_PAPERS = 100;

/** How many papers of their own a reader may keep. Read on each add, so a test can set it for the one case that needs a small cap. */
export function maxPrivatePapers(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.PAPER_PRIVATE_MAX_PER_USER);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_PRIVATE_PAPERS;
}
