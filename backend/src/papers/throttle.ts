/**
 * A sliding window per key: at most `limit` hits in `windowMs`. `hit` answers null when allowed, or the
 * seconds to wait. It protects the third-party quota and the catalog from one signed-in user.
 *
 * ponytail: per process; a shared store only if several API replicas make the per-user limit leak.
 */
export class Throttle {
  private readonly hits = new Map<number, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  hit(key: number, now = Date.now()): number | null {
    const recent = (this.hits.get(key) ?? []).filter(
      (at) => now - at < this.windowMs,
    );
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return Math.ceil((recent[0] + this.windowMs - now) / 1000);
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.hits.delete(this.hits.keys().next().value!);
    return null;
  }
}
