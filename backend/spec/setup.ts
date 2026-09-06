// Server is expected to be running (e.g. via docker-compose).
const BASE = process.env.API_URL ?? 'http://localhost/api';

// Wipes leftover test users from previous runs (e.g. accumulated leaderboard
// entries) so the suite starts from a clean slate.
export async function setup() {
  await fetch(`${BASE}/auth/_test/reset`, { method: 'POST' });
}

export function teardown() {}
