import { DataSource } from 'typeorm';

/** Arbitrary but fixed: every API replica must contend for the same Postgres advisory lock. */
const BOOT_LOCK_KEY = 424_242;

/**
 * Its own lock for the search index rebuild: `app.init()` returns before that rebuild (it is not
 * awaited), so the boot lock above is long released by the time it runs.
 */
export const REINDEX_LOCK_KEY = 424_243;

/**
 * Runs `work` while holding a Postgres session-level advisory lock, so when several API
 * replicas boot at once (a fresh stack, or Swarm rescheduling both) only one at a time applies
 * migrations and runs the seed. Without it, two replicas could both see "no questions yet" and
 * insert the question bank twice, or race on the same migration. The lock lives on one
 * dedicated connection and is released explicitly (and by Postgres if the process dies).
 */
export async function withBootLock<T>(
  dataSource: DataSource,
  work: () => Promise<T>,
  key = BOOT_LOCK_KEY,
): Promise<T> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    await runner.query('SELECT pg_advisory_lock($1)', [key]);
    try {
      return await work();
    } finally {
      await runner.query('SELECT pg_advisory_unlock($1)', [key]);
    }
  } finally {
    await runner.release();
  }
}
