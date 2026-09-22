import { DataSource } from 'typeorm';

/** Arbitrary but fixed: every API replica must contend for the same Postgres advisory lock. */
const BOOT_LOCK_KEY = 424_242;

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
): Promise<T> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    await runner.query('SELECT pg_advisory_lock($1)', [BOOT_LOCK_KEY]);
    try {
      return await work();
    } finally {
      await runner.query('SELECT pg_advisory_unlock($1)', [BOOT_LOCK_KEY]);
    }
  } finally {
    await runner.release();
  }
}
