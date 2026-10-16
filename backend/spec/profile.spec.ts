import { beforeAll, describe, expect, it } from 'vitest';
import { getCatalog } from '../src/achievements/load-seed';
import { get, json, login, post, put } from './helpers';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const k8s = getCatalog().tracks.find((t) => t.source.kind === 'concepts' && t.source.module === 'kubernetes-concepts')!;

interface Me { id: number; profilePublic: boolean; publicProfileId: string; githubLogin: string }
interface Profile {
  displayName: string; avatarUrl: string; level: { number: number; title: string }; xp: number;
  badges: Record<string, unknown>[]; trophies: Record<string, unknown>[];
}

const me = async (cookie: string) => json<Me>(await get('/auth/me', { Cookie: cookie }));
const setPublic = (cookie: string, profilePublic: unknown) => put('/auth/settings', { profilePublic }, { Cookie: cookie });
const profile = (id: string) => get(`/profile/${id}`);
/** A fresh user: the cookie, the public id, and the login the profile must never be reachable by. */
async function user(name: string) {
  const { cookie } = await login(`${name}-${Date.now()}`);
  return { cookie, ...(await me(cookie)) };
}

describe('public profile id', () => {
  it('is a database-made UUIDv7, present from the start and different for each user', async () => {
    const [a, b] = [await user('pp-a'), await user('pp-b')];
    expect(a.publicProfileId).toMatch(UUID_V7);
    expect(b.publicProfileId).toMatch(UUID_V7);
    expect(a.publicProfileId).not.toBe(b.publicProfileId);
    expect(a.profilePublic).toBe(true);
  });

  it('cannot be chosen or changed by the client', async () => {
    const u = await user('pp-immutable');
    const forged = '01a14000-0000-7000-8000-000000000bad';
    const res = await put('/auth/settings', { publicProfileId: forged, id: 999999 }, { Cookie: u.cookie });
    expect(res.status).toBe(200);
    const after = await me(u.cookie);
    expect(after.publicProfileId).toBe(u.publicProfileId);
    expect(after.id).toBe(u.id);
  });

  it('is not derived from the GitHub login, and the login is not a way in', async () => {
    const u = await user('pp-rename');
    expect((await profile(u.publicProfileId)).status).toBe(200);
    expect(u.publicProfileId).not.toContain(u.githubLogin);
    expect((await profile(u.githubLogin)).status).toBe(404);
  });
});

describe('GET /profile/:publicProfileId', () => {
  it('needs no session, and shows exactly the allowed fields at every depth', async () => {
    const u = await user('pp-shape');
    await put('/auth/settings', { displayName: 'Ada Lovelace' }, { Cookie: u.cookie });
    for (const unit of k8s.sessions[0].units) {
      await put(`/kubernetes-concepts/${unit.sourceId.slice('kubernetes:'.length)}/read`, {}, { Cookie: u.cookie });
    }
    expect((await post('/xp/achievements/sync', {}, { Cookie: u.cookie })).status).toBe(201);

    const res = await profile(u.publicProfileId);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await json<Profile>(res);

    expect(Object.keys(body).sort()).toEqual(['avatarUrl', 'badges', 'displayName', 'level', 'trophies', 'xp']);
    expect(Object.keys(body.level).sort()).toEqual(['number', 'title']);
    expect(body.displayName).toBe('Ada Lovelace');
    expect(body.xp).toBe(k8s.sessions[0].units.length * 12);
    expect(body.badges).toHaveLength(1);
    expect(body.trophies).toEqual([]);
    expect(Object.keys(body.badges[0]).sort()).toEqual(['awardedAt', 'exp', 'iconSlug', 'id', 'passed', 'retired', 'title', 'trackTitle', 'type']);

    const raw = JSON.stringify(body);
    for (const secret of ['githubId', 'githubLogin', 'email', 'userId', 'streak', 'history', 'sourceId']) {
      expect(raw, `leaked ${secret}`).not.toContain(secret);
    }
    expect(raw).not.toContain(u.githubLogin);
  });
});

describe('going private', () => {
  it('answers 404 exactly like an id that never existed, and never stores the response', async () => {
    const u = await user('pp-private');
    expect((await setPublic(u.cookie, false)).status).toBe(200);
    expect((await me(u.cookie)).profilePublic).toBe(false);

    const privateRes = await profile(u.publicProfileId);
    const unknownRes = await profile('01a14000-0000-7000-8000-00000000dead');
    expect(privateRes.status).toBe(404);
    expect(unknownRes.status).toBe(404);
    expect(await privateRes.text()).toBe(await unknownRes.text());
    expect(privateRes.headers.get('cache-control')).toBe('no-store');
  });

  it('can be switched back on, and the same link works again', async () => {
    const u = await user('pp-toggle');
    await setPublic(u.cookie, false);
    expect((await profile(u.publicProfileId)).status).toBe(404);
    await setPublic(u.cookie, true);
    expect((await profile(u.publicProfileId)).status).toBe(200);
    expect((await me(u.cookie)).publicProfileId).toBe(u.publicProfileId);
  });

  it('rejects a non-boolean value without touching anything else in the same request', async () => {
    const u = await user('pp-badvalue');
    for (const bad of ['false', 0, null, 'no', {}]) {
      const res = await put('/auth/settings', { profilePublic: bad, displayName: 'Should Not Apply' }, { Cookie: u.cookie });
      expect(res.status, `value ${JSON.stringify(bad)}`).toBe(400);
    }
    const after = await me(u.cookie);
    expect(after.profilePublic).toBe(true);
    expect((await json<Profile>(await profile(u.publicProfileId))).displayName).not.toBe('Should Not Apply');
  });

  it('needs a session to change the setting', async () => {
    expect((await put('/auth/settings', { profilePublic: false })).status).toBe(401);
  });
});

describe('malformed ids', () => {
  it('are a plain 404, never a server error', async () => {
    for (const bad of ['not-a-uuid', '1', '0', "'%20OR%201=1", '..%2Fetc%2Fpasswd', '01A14000-0000-7000-8000-000000000001']) {
      expect((await profile(bad)).status, bad).toBe(404);
    }
  });

  it('are refused, not served, even when absurdly long (the router rejects an oversized parameter with 414)', async () => {
    const status = (await profile('A'.repeat(300))).status;
    expect([404, 414]).toContain(status);
  });
});

describe('leaderboard and privacy', () => {
  // Same reasoning as xp-gamification.spec: the board is capped at the top 10, so wipe the other
  // spec files' test users before asserting who is on it.
  beforeAll(async () => {
    await post('/auth/_test/reset', {});
  });

  const board = async () => json<{ userId: number }[]>(await get('/xp/leaderboard'));

  it('lists a public user, drops them when private, and brings them back', async () => {
    const u = await user('pp-board');
    await put(`/java-concepts/iterator-vs-iterable/read`, {}, { Cookie: u.cookie });

    expect((await board()).some((r) => r.userId === u.id)).toBe(true);
    await setPublic(u.cookie, false);
    expect((await board()).some((r) => r.userId === u.id)).toBe(false);
    await setPublic(u.cookie, true);
    expect((await board()).some((r) => r.userId === u.id)).toBe(true);
  });

  it('is never stored', async () => {
    expect((await get('/xp/leaderboard')).headers.get('cache-control')).toBe('no-store');
  });
});
