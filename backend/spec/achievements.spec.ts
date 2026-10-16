import { describe, it, expect } from 'vitest';
import { AWARD_XP, type CatalogTrack, type Unit } from '../src/achievements/catalog';
import { getCatalog } from '../src/achievements/load-seed';
import { fromSourceId, parseCurriculumSourceId } from '../src/concept-lookup/concept-lookup.constants';
import { get, json, login, post, put } from './helpers';

// The CI stack enables Kubernetes, OCP java-25 and software-distributed/distributed-systems-laboratory
// (.ci/compose.test.yml). Every other track is disabled, which these specs rely on.
const catalog = getCatalog();
const track = (pick: (t: CatalogTrack) => boolean) => catalog.tracks.find(pick)!;
const k8s = track((t) => t.source.kind === 'concepts' && t.source.module === 'kubernetes-concepts');
const j25 = track((t) => t.source.kind === 'course' && t.source.courseId === 'java-25');
const j21 = track((t) => t.source.kind === 'course' && t.source.courseId === 'java-21');
const ccSmall = track((t) => t.source.kind === 'curriculum' && t.source.discipline === 'distributed-systems-laboratory');
const ccOff = track((t) => t.source.kind === 'curriculum' && t.source.discipline === 'ai-ml-laboratory');

interface Award { type: 'badge' | 'trophy'; id: string; title: string; exp: number; awardedAt: string; passed: boolean; retired: boolean }
interface Progress {
  trackId: string; done: number; total: number; complete: boolean; awarded: boolean; newSinceAward: number; nextRoute: string[] | null;
  sessions: { sessionId: string; done: number; total: number; complete: boolean; awarded: boolean }[];
}
interface Achievements { awards: Award[]; progress: Progress[] }

/** Marks one unit done through the same endpoint the app uses for it. */
async function complete(cookie: string, t: CatalogTrack, unit: Unit): Promise<void> {
  const headers = { Cookie: cookie };
  let res: Response;
  if (unit.sourceType === 'lesson') {
    const courseId = (t.source as { courseId: string }).courseId;
    res = await put(`/progress/${courseId}/${unit.sourceId}`, { status: 'completed' }, headers);
  } else if (t.source.kind === 'curriculum') {
    const cc = parseCurriculumSourceId(unit.sourceId)!;
    res = await put(`/curriculum/${cc.module}/${cc.discipline}/${cc.slug}/read`, {}, headers);
  } else {
    res = await put(`/kubernetes-concepts/${unit.sourceId.slice('kubernetes:'.length)}/read`, {}, headers);
  }
  expect(res.status, `completing ${unit.sourceId}`).toBe(200);
}

const completeAll = async (cookie: string, t: CatalogTrack, units: Unit[]) => {
  for (const unit of units) await complete(cookie, t, unit);
};
const sync = async (cookie: string) =>
  (await json<{ newAwards: Award[] }>(await post('/xp/achievements/sync', {}, { Cookie: cookie }))).newAwards;
const achievements = async (cookie: string) => json<Achievements>(await get('/xp/achievements', { Cookie: cookie }));
const xpTotal = async (cookie: string) => (await json<{ total: number }>(await get('/xp', { Cookie: cookie }))).total;
const user = async (name: string) => (await login(`${name}-${Date.now()}`)).cookie;

describe('auth', () => {
  it('requires a session to read or sync achievements', async () => {
    expect((await get('/xp/achievements')).status).toBe(401);
    expect((await post('/xp/achievements/sync', {})).status).toBe(401);
  });
});

describe('GET /xp/achievements', () => {
  it('lists only the enabled tracks, with nothing done and no awards, for a fresh user', async () => {
    const cookie = await user('ach-fresh');
    const body = await achievements(cookie);
    expect(body.awards).toEqual([]);
    expect(body.progress.map((p) => p.trackId).sort()).toEqual([k8s.trackId, j25.trackId, ccSmall.trackId].sort());
    expect(body.progress.find((p) => p.trackId === k8s.trackId)).toMatchObject({ done: 0, total: 50, complete: false });
    expect(body.progress.some((p) => p.trackId === j21.trackId || p.trackId === ccOff.trackId)).toBe(false);
  });

  it('never grants anything: reading is not writing', async () => {
    const cookie = await user('ach-readonly');
    const session = k8s.sessions[0];
    await completeAll(cookie, k8s, session.units);
    const before = await xpTotal(cookie);
    for (let i = 0; i < 3; i++) expect((await achievements(cookie)).awards).toEqual([]);
    expect(await xpTotal(cookie)).toBe(before);
    expect(before).toBe(session.units.length * 10);
  });

  it('suggests the first unread unit in editorial order, whatever order the user read in, and never blocks', async () => {
    const cookie = await user('ach-next');
    const [first, second, third] = k8s.sessions[0].units;
    await completeAll(cookie, k8s, [third, first]);
    const progress = (await achievements(cookie)).progress.find((p) => p.trackId === k8s.trackId)!;
    expect(progress.sessions[0]).toMatchObject({ done: 2, complete: false });
    expect(progress.nextRoute).toEqual(['/kubernetes-concepts', second.sourceId.slice('kubernetes:'.length)]);
  });

  it('does not show one user another user\'s progress or awards', async () => {
    const [a, b] = [await user('ach-iso-a'), await user('ach-iso-b')];
    await completeAll(a, k8s, k8s.sessions[0].units);
    await sync(a);
    expect((await achievements(b)).awards).toEqual([]);
    expect((await achievements(b)).progress.find((p) => p.trackId === k8s.trackId)!.done).toBe(0);
  });
});

describe('POST /xp/achievements/sync: badges', () => {
  it('awards a completed session once, worth 2 XP per unit, dated by the last unit, and adds it to the XP total', async () => {
    const cookie = await user('ach-badge');
    const session = k8s.sessions[0];
    const n = session.units.length;
    await completeAll(cookie, k8s, session.units);

    const history = await json<{ sourceId: string; updatedAt: string }[]>(await get('/xp/history', { Cookie: cookie }));
    const lastUnit = Math.max(...history.filter((h) => session.units.some((u) => u.sourceId === h.sourceId)).map((h) => Date.parse(h.updatedAt)));

    const awards = await sync(cookie);
    expect(awards).toHaveLength(1);
    expect(awards[0]).toMatchObject({ type: 'badge', id: session.sessionId, title: session.title, exp: n * AWARD_XP.badgePerUnit, retired: false, passed: false });
    // the award takes the day of an existing unit, so it cannot invent an activity day
    expect(Date.parse(awards[0].awardedAt)).toBe(lastUnit);

    expect(await sync(cookie)).toEqual([]);
    expect(await xpTotal(cookie)).toBe(n * 10 + n * AWARD_XP.badgePerUnit);
    const state = await achievements(cookie);
    expect(state.awards.map((a) => a.id)).toEqual([session.sessionId]);
    expect(state.progress.find((p) => p.trackId === k8s.trackId)!.sessions[0]).toMatchObject({ complete: true, awarded: true });
  });

  it('does not change the streak or add a second activity day', async () => {
    const cookie = await user('ach-streak');
    await completeAll(cookie, k8s, k8s.sessions[0].units);
    const before = await json<{ current: number; longest: number }>(await get('/xp/streak', { Cookie: cookie }));
    await sync(cookie);
    expect(await json(await get('/xp/streak', { Cookie: cookie }))).toEqual(before);
    expect(before).toEqual({ current: 1, longest: 1 });
  });

  it('records each award exactly once when syncs run at the same time', async () => {
    const cookie = await user('ach-race');
    const session = k8s.sessions[1];
    await completeAll(cookie, k8s, session.units);
    const results = await Promise.all([sync(cookie), sync(cookie), sync(cookie), sync(cookie)]);
    expect(results.flat()).toHaveLength(1);
    expect(await xpTotal(cookie)).toBe(session.units.length * (10 + AWARD_XP.badgePerUnit));
    expect((await achievements(cookie)).awards).toHaveLength(1);
  });

  it('awards an OCP module badge from its lessons, labelled passed because it ends in a skill check', async () => {
    const cookie = await user('ach-ocp');
    const session = j25.sessions[0];
    await completeAll(cookie, j25, session.units);
    const awards = await sync(cookie);
    expect(awards).toHaveLength(1);
    expect(awards[0]).toMatchObject({ type: 'badge', id: session.sessionId, exp: session.units.length * AWARD_XP.badgePerUnit, passed: true });
    const progress = (await achievements(cookie)).progress.find((p) => p.trackId === j25.trackId)!;
    expect(progress).toMatchObject({ done: session.units.length, awarded: false });
    expect(progress.nextRoute).toEqual(['/java/exam', 'java-25', 'lesson', j25.sessions[1].units[0].sourceId]);
  });
});

describe('POST /xp/achievements/sync: trophies', () => {
  it('awards ten badges then the trophy when a whole track is done, and nothing more on repeat', async () => {
    const cookie = await user('ach-track');
    await completeAll(cookie, k8s, k8s.units);
    const awards = await sync(cookie);
    expect(awards.map((a) => a.type)).toEqual([...Array(10).fill('badge'), 'trophy']);
    expect(awards[10]).toMatchObject({ id: k8s.trackId, exp: k8s.sessions.length * AWARD_XP.trophyPerModule, retired: false });
    const bonus = k8s.units.length * AWARD_XP.badgePerUnit + k8s.sessions.length * AWARD_XP.trophyPerModule;
    expect(bonus).toBe(150);
    expect(await xpTotal(cookie)).toBe(k8s.units.length * 10 + bonus);
    expect(await sync(cookie)).toEqual([]);
    expect((await achievements(cookie)).progress.find((p) => p.trackId === k8s.trackId)).toMatchObject({ complete: true, awarded: true, newSinceAward: 0 });
  });

  it('gives a track of direct units a trophy only, worth 5 XP', async () => {
    const cookie = await user('ach-cc');
    await completeAll(cookie, ccSmall, ccSmall.units);
    const awards = await sync(cookie);
    expect(awards).toHaveLength(1);
    expect(awards[0]).toMatchObject({ type: 'trophy', id: ccSmall.trackId, title: ccSmall.title, exp: AWARD_XP.trophyPerModule });
    expect(await xpTotal(cookie)).toBe(ccSmall.units.length * 10 + AWARD_XP.trophyPerModule);
  });

  it('awards nothing for a track that is not enabled, even when it is completed', async () => {
    const cookie = await user('ach-off');
    await completeAll(cookie, ccOff, ccOff.units);
    expect(await sync(cookie)).toEqual([]);
    const state = await achievements(cookie);
    expect(state.awards).toEqual([]);
    expect(state.progress.some((p) => p.trackId === ccOff.trackId)).toBe(false);
    expect(await xpTotal(cookie)).toBe(ccOff.units.length * 10);
  });
});

describe('contract: the id a read endpoint records is the id the catalog counts', () => {
  // Every concept module a track draws from. The constants that build catalog ids and each
  // controller's own prefix are written separately, so only a real request proves they agree.
  const modules = [...new Set(catalog.tracks.flatMap((t) => (t.source.kind === 'concepts' ? [t.source.module] : [])))];

  it('covers the modules of the merge-only waves', () => {
    expect(modules).toEqual(expect.arrayContaining([
      'kubernetes-concepts', 'dotnet-concepts', 'csharp-concepts', 'jvm-concepts', 'quarkus-concepts',
      'ruby-concepts', 'rubyonrails-concepts', 'spring-concepts',
    ]));
  });

  for (const module of modules) {
    it(`${module}: the recorded source id equals the catalog unit`, async () => {
      const unit = catalog.tracks.find((t) => t.source.kind === 'concepts' && t.source.module === module)!.units[0];
      const slug = fromSourceId('concept-read', unit.sourceId)!.slug;
      const cookie = await user('ach-contract');

      expect((await put(`/${module}/${slug}/read`, {}, { Cookie: cookie })).status).toBe(200);
      const history = await json<{ sourceType: string; sourceId: string }[]>(await get('/xp/history', { Cookie: cookie }));

      expect(history.map((h) => h.sourceId), `${module} recorded something else than ${unit.sourceId}`).toContain(unit.sourceId);
    });
  }
});
