import { beforeAll, describe, expect, it } from 'vitest';
import { getCatalog } from '../src/achievements/load-seed';
import { get, json, login, post, put } from './helpers';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const k8s = getCatalog().tracks.find((t) => t.source.kind === 'concepts' && t.source.module === 'kubernetes-concepts')!;

interface Me { id: number; profilePublic: boolean; publicProfileId: string; profileSlug: string | null; githubLogin: string }
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

  it('gives each row the public profile id it links to, and that id really opens the profile', async () => {
    const u = await user('pp-board-link');
    await put(`/java-concepts/iterator-vs-iterable/read`, {}, { Cookie: u.cookie });

    const row = (await json<{ userId: number; publicProfileId: string; displayName: string }[]>(await get('/xp/leaderboard'))).find((r) => r.userId === u.id)!;
    expect(row.publicProfileId).toBe(u.publicProfileId);
    expect(row.publicProfileId).toMatch(UUID_V7);
    const opened = await profile(row.publicProfileId);
    expect(opened.status).toBe(200);
    expect((await json<Profile>(opened)).displayName).toBe(row.displayName);
  });

  it('only ever lists users whose profile opens, so no row links to a 404', async () => {
    const [open, hidden] = [await user('pp-board-open'), await user('pp-board-hidden')];
    for (const u of [open, hidden]) await put(`/java-concepts/iterator-vs-iterable/read`, {}, { Cookie: u.cookie });
    await setPublic(hidden.cookie, false);

    for (const row of await json<{ publicProfileId: string }[]>(await get('/xp/leaderboard'))) {
      expect((await profile(row.publicProfileId)).status, row.publicProfileId).toBe(200);
    }
  });
});

describe('vanity slug', () => {
  const setSlug = (cookie: string, slug: unknown) => put('/auth/profile-slug', { slug }, { Cookie: cookie });
  /** A slug no other run can have taken: 3 to 30 chars, lowercase. */
  const fresh = (tag: string) => `${tag}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const code = async (res: Response) => (await json<{ code: string }>(res)).code;

  it('starts empty, and the id link works without one', async () => {
    const u = await user('slug-empty');
    expect(u.profileSlug).toBeNull();
    expect((await profile(u.publicProfileId)).status).toBe(200);
  });

  it('opens the same profile as the id, which keeps working', async () => {
    const u = await user('slug-open');
    const slug = fresh('open');
    const res = await setSlug(u.cookie, slug);
    expect(res.status).toBe(200);
    expect((await json<Me>(res)).profileSlug).toBe(slug);
    expect((await me(u.cookie)).profileSlug).toBe(slug);
    const [bySlug, byId] = await Promise.all([profile(slug), profile(u.publicProfileId)]);
    expect(bySlug.status).toBe(200);
    expect(await bySlug.json()).toEqual(await byId.json());
    expect((await me(u.cookie)).publicProfileId).toBe(u.publicProfileId);
  });

  it('is stored in lowercase and found in any letter case', async () => {
    const u = await user('slug-case');
    const slug = fresh('case');
    await setSlug(u.cookie, slug.toUpperCase());
    expect((await me(u.cookie)).profileSlug).toBe(slug);
    expect((await profile(slug.toUpperCase())).status).toBe(200);
    expect((await profile(slug)).status).toBe(200);
  });

  it('goes back to the id link only when cleared, by null or by a blank value', async () => {
    const u = await user('slug-clear');
    for (const empty of [null, '', '   ']) {
      const slug = fresh('clear');
      await setSlug(u.cookie, slug);
      expect((await profile(slug)).status).toBe(200);
      expect((await setSlug(u.cookie, empty)).status, JSON.stringify(empty)).toBe(200);
      expect((await me(u.cookie)).profileSlug).toBeNull();
      expect((await profile(slug)).status).toBe(404);
      expect((await profile(u.publicProfileId)).status).toBe(200);
    }
  });

  it('refuses a broken rule with 400 and says which, changing nothing', async () => {
    const u = await user('slug-rules');
    const keep = fresh('keep');
    await setSlug(u.cookie, keep);
    const cases: [unknown, string][] = [['ab', 'length'], ['a'.repeat(31), 'length'], ['has space', 'format'], ['-lead', 'format'], ['dou--ble', 'format'], ['under_score', 'format'], ['admin', 'reserved'], ['Leaderboard', 'reserved']];
    for (const [value, expected] of cases) {
      const res = await setSlug(u.cookie, value);
      expect(res.status, JSON.stringify(value)).toBe(400);
      expect(await code(res), JSON.stringify(value)).toBe(expected);
    }
    expect((await me(u.cookie)).profileSlug).toBe(keep);
  });

  it('refuses a value that is not a string or null', async () => {
    const u = await user('slug-type');
    for (const bad of [123, true, {}, ['x']]) expect((await setSlug(u.cookie, bad)).status, JSON.stringify(bad)).toBe(400);
    expect((await put('/auth/profile-slug', {}, { Cookie: u.cookie })).status).toBe(400);
    expect((await me(u.cookie)).profileSlug).toBeNull();
  });

  it('is first come, first served, whatever the letter case, and the loser keeps what they had', async () => {
    const [a, b] = [await user('slug-taken-a'), await user('slug-taken-b')];
    const slug = fresh('taken');
    expect((await setSlug(a.cookie, slug)).status).toBe(200);
    for (const attempt of [slug, slug.toUpperCase()]) {
      const res = await setSlug(b.cookie, attempt);
      expect(res.status, attempt).toBe(409);
      expect(await code(res)).toBe('taken');
    }
    expect((await me(b.cookie)).profileSlug).toBeNull();
    expect((await me(a.cookie)).profileSlug).toBe(slug);
  });

  it('lets the owner save their own slug again without it counting as taken', async () => {
    const u = await user('slug-same');
    const slug = fresh('same');
    expect((await setSlug(u.cookie, slug)).status).toBe(200);
    expect((await setSlug(u.cookie, slug)).status).toBe(200);
  });

  it('frees the old slug when it is changed, and the old link stops opening', async () => {
    const [a, b] = [await user('slug-free-a'), await user('slug-free-b')];
    const [first, second] = [fresh('first'), fresh('second')];
    await setSlug(a.cookie, first);
    await setSlug(a.cookie, second);
    expect((await profile(first)).status).toBe(404);
    expect((await profile(second)).status).toBe(200);
    expect((await setSlug(b.cookie, first)).status).toBe(200);
    expect((await profile(first)).status).toBe(200);
  });

  it('lets only one of two simultaneous claims win', async () => {
    const [a, b] = [await user('slug-race-a'), await user('slug-race-b')];
    const slug = fresh('race');
    const statuses = (await Promise.all([setSlug(a.cookie, slug), setSlug(b.cookie, slug)])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
  });

  it('follows the profile into privacy: a private profile answers 404 for its slug, exactly like one that never existed', async () => {
    const u = await user('slug-private');
    const slug = fresh('private');
    await setSlug(u.cookie, slug);
    await setPublic(u.cookie, false);
    const privateRes = await profile(slug);
    const unknownRes = await profile(fresh('nobody'));
    expect(privateRes.status).toBe(404);
    expect(await privateRes.text()).toBe(await unknownRes.text());
    expect(privateRes.headers.get('cache-control')).toBe('no-store');
    await setPublic(u.cookie, true);
    expect((await profile(slug)).status).toBe(200);
  });

  it('needs a session to change it', async () => {
    expect((await put('/auth/profile-slug', { slug: fresh('anon') })).status).toBe(401);
  });

  it('is not a way to reach a profile by its GitHub login unless the owner chose that name', async () => {
    const u = await user('slug-login');
    expect((await profile(u.githubLogin)).status).toBe(404);
  });
});

describe('vanity slug and the leaderboard', () => {
  // The board is capped at the top 10: wipe the other specs' test users first, like 'leaderboard and privacy'.
  beforeAll(async () => {
    await post('/auth/_test/reset', {});
  });

  const setSlug = (cookie: string, slug: unknown) => put('/auth/profile-slug', { slug }, { Cookie: cookie });

  it('is given to the leaderboard row, which links to it, and is null until chosen', async () => {
    const u = await user('slug-board');
    await put(`/java-concepts/iterator-vs-iterable/read`, {}, { Cookie: u.cookie });
    const row = async () => (await json<{ userId: number; profileSlug: string | null }[]>(await get('/xp/leaderboard'))).find((r) => r.userId === u.id)!;
    expect((await row()).profileSlug).toBeNull();
    const slug = `board-${Date.now().toString(36)}`;
    await setSlug(u.cookie, slug);
    expect((await row()).profileSlug).toBe(slug);
    expect((await profile((await row()).profileSlug!)).status).toBe(200);
  });
});

describe('GET /og/profile/:key (share image)', () => {
  const png = async (key: string) => {
    const res = await get(`/og/profile/${key}`);
    return { res, bytes: Buffer.from(await res.arrayBuffer()) };
  };

  it('draws a PNG for a public profile, and the same generic image for a private or unknown one', async () => {
    const u = await user('pp-og');
    const open = await png(u.publicProfileId);
    expect(open.res.status).toBe(200);
    expect(open.res.headers.get('content-type')).toBe('image/png');

    await setPublic(u.cookie, false);
    const closed = await png(u.publicProfileId);
    const unknown = await png('01a14000-0000-7000-8000-00000000dead');
    expect(closed.res.status).toBe(200);
    expect(closed.bytes.equals(unknown.bytes)).toBe(true);
    expect(closed.bytes.equals(open.bytes)).toBe(false);
  });
});
