import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  AWARD_XP, buildCatalog, compatProblems, computeProgress, evaluateAwards, unitKey,
  type PublishedSnapshot, type SeedInput, type TrackManifest, type Unit,
} from '../src/achievements/catalog';
import { getCatalog, getUnitTitles, loadSeed } from '../src/achievements/load-seed';
import { describeCatalog, describeRequirements } from '../src/achievements/view';
import { fromSourceId, parseCurriculumSourceId } from '../src/concept-lookup/concept-lookup.constants';
import { MANIFEST } from '../src/achievements/manifest';

// Fixture ids: canonical lowercase UUIDv7 (version nibble 7, variant 8 to b).
const T1 = '01a14000-0000-7000-8000-000000000001';
const S1 = '01a14000-0000-7000-8000-0000000000a1';
const S2 = '01a14000-0000-7000-8000-0000000000a2';
const S3 = '01a14000-0000-7000-8000-0000000000a3';
const T2 = '01a14000-0000-7000-8000-000000000002';
const T3 = '01a14000-0000-7000-8000-000000000003';
const S4 = '01a14000-0000-7000-8000-0000000000a4';

const concept = (slug: string, topic: string) => ({ slug, topic });
const seed: SeedInput = {
  concepts: {
    'kubernetes-concepts': [
      concept('a', 'Alpha'), concept('b', 'Alpha'), concept('c', 'Alpha'),
      concept('d', 'Beta'), concept('e', 'Beta'), concept('f', 'Beta'),
      concept('g', 'Gamma'), concept('h', 'Gamma'), concept('i', 'Gamma'),
    ],
    'jvm-concepts': [concept('x', 'Solo'), concept('y', 'Solo'), concept('z', 'Solo')],
  },
  curriculum: { 'foundations/discrete-math-logic': ['p', 'q'], 'foundations/empty': [] },
  courses: { 'java-25': [{ label: '01-values', lessons: [{ id: 'j25-1-1', type: 'slide' }, { id: 'j25-1-2', type: 'skill-check' }] }] },
};
const manifest: TrackManifest[] = [
  {
    trackId: T1, title: 'K8s', status: 'active', source: { kind: 'concepts', module: 'kubernetes-concepts', groupBy: 'topic' },
    sessions: [
      { sessionId: S1, title: 'Alpha', label: 'Alpha' },
      { sessionId: S2, title: 'Beta', label: 'Beta' },
      { sessionId: S3, title: 'Gamma', label: 'Gamma' },
    ],
  },
  {
    trackId: T2, title: 'One session', status: 'active', source: { kind: 'concepts', module: 'jvm-concepts', groupBy: 'topic' },
    sessions: [{ sessionId: S4, title: 'Solo', label: 'Solo' }],
  },
  { trackId: T3, title: 'Direct', status: 'active', source: { kind: 'curriculum', module: 'foundations', discipline: 'discrete-math-logic' } },
];

const k = (slug: string): Unit => ({ sourceType: 'concept-read', sourceId: `kubernetes:${slug}` });
const j = (slug: string): Unit => ({ sourceType: 'concept-read', sourceId: `jvm:${slug}` });
const cc = (slug: string): Unit => ({ sourceType: 'concept-read', sourceId: `cc:foundations:discrete-math-logic:${slug}` });
const day = (n: number) => new Date(Date.UTC(2026, 9, n));
const dates = (entries: [Unit, Date][]) => new Map(entries.map(([u, d]) => [unitKey(u), d]));
const catalog = buildCatalog(seed, manifest);

describe('buildCatalog', () => {
  it('builds sessions and direct-unit tracks with no problems', () => {
    expect(catalog.problems).toEqual([]);
    const [k8s, solo, direct] = catalog.tracks;
    expect(k8s.sessions.map((s) => s.units.length)).toEqual([3, 3, 3]);
    expect(k8s.units).toHaveLength(9);
    expect(solo.sessions).toHaveLength(1);
    expect(direct.sessions).toEqual([]);
    expect(direct.units).toEqual([cc('p'), cc('q')]);
  });

  it('flags a session whose seed label disappeared, and a label with no session, and stops that track awarding', () => {
    const renamed = { ...seed, concepts: { ...seed.concepts, 'kubernetes-concepts': seed.concepts['kubernetes-concepts'].map((c) => (c.topic === 'Beta' ? { ...c, topic: 'Beta 2' } : c)) } };
    const built = buildCatalog(renamed, manifest);
    const messages = built.problems.filter((p) => p.level === 'error').map((p) => p.message).join('\n');
    expect(messages).toContain('binds to label "Beta" which has no units');
    expect(messages).toContain('label "Beta 2" belong to no session');
    expect(built.tracks[0].valid).toBe(false);
    const everything = dates(built.tracks.flatMap((t) => t.units).map((u) => [u, day(1)]));
    expect(evaluateAwards(built, everything, new Set()).filter((a) => a.sourceId === T1)).toEqual([]);
  });

  it('rejects ids that are not canonical UUIDv7 or are used twice', () => {
    const bad = buildCatalog(seed, [{ ...manifest[0], trackId: '550e8400-e29b-41d4-a716-446655440000' }, { ...manifest[1], trackId: T3 }, manifest[2]]);
    const messages = bad.problems.map((p) => p.message).join('\n');
    expect(messages).toContain('is not a canonical lowercase UUIDv7');
    expect(messages).toContain('is used twice');
  });

  it('warns, without blocking, about a concept session outside 3 to 12 units', () => {
    const small = buildCatalog({ ...seed, concepts: { ...seed.concepts, 'jvm-concepts': [concept('x', 'Solo')] } }, manifest);
    expect(small.problems).toEqual([{ level: 'warning', trackId: T2, message: expect.stringContaining('has 1 units') }]);
    expect(small.tracks[1].valid).toBe(true);
  });

  it('marks a course session that ends in a skill-check as assessed', () => {
    const course: TrackManifest = {
      trackId: T1, title: 'OCP', status: 'active', source: { kind: 'course', courseId: 'java-25' },
      sessions: [{ sessionId: S1, title: 'Values', label: '01-values' }],
    };
    const built = buildCatalog(seed, [course]);
    expect(built.problems).toEqual([]);
    expect(built.tracks[0].sessions[0]).toMatchObject({ hasAssessment: true, units: [{ sourceType: 'lesson', sourceId: 'j25-1-1' }, { sourceType: 'lesson', sourceId: 'j25-1-2' }] });
  });
});

describe('buildCatalog: categories and merged topics', () => {
  const c = (slug: string, topic: string, category: string) => ({ slug, topic, category });
  const dotnet: SeedInput = {
    ...seed,
    concepts: {
      'dotnet-concepts': [
        c('a1', 'Alpha', 'One'), c('a2', 'Alpha', 'One'), c('a3', 'Alpha', 'One'),
        c('b1', 'Beta', 'One'), c('b2', 'Beta', 'One'),
        c('t1', 'Tiny', 'One'),
        c('x1', 'Other', 'Two'), c('x2', 'Other', 'Two'), c('x3', 'Other', 'Two'),
      ],
    },
  };
  const track = (category: string, sessions: TrackManifest['sessions']): TrackManifest => ({
    trackId: T1, title: category, status: 'active',
    source: { kind: 'concepts', module: 'dotnet-concepts', groupBy: 'topic', category }, sessions,
  });

  it('keeps only the concepts of the track\'s category, so one module can feed several tracks', () => {
    const built = buildCatalog(dotnet, [track('Two', [{ sessionId: S1, title: 'Other', label: 'Other' }])]);
    expect(built.problems).toEqual([]);
    expect(built.tracks[0].units.map((u) => u.sourceId)).toEqual(['dotnet:x1', 'dotnet:x2', 'dotnet:x3']);
  });

  it('merges several small topics into one session, without touching the seed', () => {
    const built = buildCatalog(dotnet, [track('One', [
      { sessionId: S1, title: 'Alpha', label: 'Alpha' },
      { sessionId: S2, title: 'Beta and Tiny', label: ['Beta', 'Tiny'] },
    ])]);
    expect(built.problems).toEqual([]);
    expect(built.tracks[0].sessions.map((s) => s.units.length)).toEqual([3, 3]);
  });

  it('refuses a topic that no session claims, or that two sessions claim', () => {
    const missing = buildCatalog(dotnet, [track('One', [{ sessionId: S1, title: 'Alpha', label: 'Alpha' }])]);
    expect(missing.problems.map((p) => p.message).join('\n')).toContain('label "Beta" belong to no session');
    expect(missing.tracks[0].valid).toBe(false);

    const twice = buildCatalog(dotnet, [track('One', [
      { sessionId: S1, title: 'Alpha', label: ['Alpha', 'Beta'] },
      { sessionId: S2, title: 'Beta again', label: ['Beta', 'Tiny'] },
    ])]);
    expect(twice.problems.map((p) => p.message).join('\n')).toContain('label "Beta" is bound by two sessions');
    expect(twice.tracks[0].valid).toBe(false);
  });

  it('reports a merged label that no longer exists in the seed', () => {
    const built = buildCatalog(dotnet, [track('One', [
      { sessionId: S1, title: 'Alpha', label: 'Alpha' },
      { sessionId: S2, title: 'Gone', label: ['Beta', 'Tiny', 'Renamed'] },
    ])]);
    expect(built.problems.map((p) => p.message).join('\n')).toContain('label "Renamed" which has no units');
  });
});

describe('buildCatalog: editorial sessions', () => {
  const c = (slug: string, topic: string, session?: string) => ({ slug, topic, category: 'One', session });
  const spring: SeedInput = {
    ...seed,
    concepts: {
      'spring-concepts': [
        c('a1', 'Left', 'First'), c('a2', 'Right', 'First'), c('a3', 'Left', 'First'),
        c('b1', 'Left', 'Second'), c('b2', 'Right', 'Second'), c('b3', 'Right', 'Second'),
        c('o1', 'Other'),
      ],
    },
  };
  const bySession = (extra: Partial<Extract<TrackManifest['source'], { kind: 'concepts' }>>, sessions?: TrackManifest['sessions']): TrackManifest => ({
    trackId: T1, title: 'Spring', status: 'active',
    source: { kind: 'concepts', module: 'spring-concepts', groupBy: 'session', category: 'One', ...extra }, sessions,
  });

  it('refuses a concept that has no session, so a new concept must be placed', () => {
    const built = buildCatalog(spring, [bySession({ topic: undefined }, [
      { sessionId: S1, title: 'First', label: 'First' },
      { sessionId: S2, title: 'Second', label: 'Second' },
    ])]);
    // the concept with no session is a label of its own: a new concept must be placed, not ignored
    expect(built.problems.map((p) => p.message)).toEqual(['1 unit(s) under label "" belong to no session (new topic without a manifest entry?)']);
    expect(built.tracks[0].valid).toBe(false);
  });

  it('builds a track of two sessions from the field, and narrows a track by topic', () => {
    const clean: SeedInput = { ...spring, concepts: { 'spring-concepts': spring.concepts['spring-concepts'].filter((x) => x.slug !== 'o1') } };
    const built = buildCatalog(clean, [bySession({}, [
      { sessionId: S1, title: 'First', label: 'First' },
      { sessionId: S2, title: 'Second', label: 'Second' },
    ])]);
    expect(built.problems).toEqual([]);
    expect(built.tracks[0].sessions.map((s) => s.units.map((u) => u.sourceId))).toEqual([
      ['spring:a1', 'spring:a2', 'spring:a3'], ['spring:b1', 'spring:b2', 'spring:b3'],
    ]);
    const left = buildCatalog(clean, [bySession({ topic: 'Left' }, [{ sessionId: S1, title: 'First', label: 'First' }, { sessionId: S2, title: 'Second', label: 'Second' }])]);
    expect(left.tracks[0].units.map((u) => u.sourceId)).toEqual(['spring:a1', 'spring:a3', 'spring:b1']);
  });

  it('allows a concepts track with no sessions: a trophy only, and every concept counts', () => {
    const built = buildCatalog(spring, [bySession({}, undefined)]);
    expect(built.problems).toEqual([]);
    expect(built.tracks[0]).toMatchObject({ valid: true, sessions: [] });
    expect(built.tracks[0].units).toHaveLength(7);
  });
});

describe('evaluateAwards', () => {
  const alpha = ['a', 'b', 'c'].map(k);
  const beta = ['d', 'e', 'f'].map(k);
  const gamma = ['g', 'h', 'i'].map(k);

  it('awards nothing for an incomplete session', () => {
    expect(evaluateAwards(catalog, dates([[k('a'), day(1)], [k('b'), day(2)]]), new Set())).toEqual([]);
  });

  it('awards the badge when the session completes, dated by its latest unit and worth 2 XP per unit', () => {
    const out = evaluateAwards(catalog, dates(alpha.map((u, i): [Unit, Date] => [u, day(1 + i)])), new Set());
    expect(out).toEqual([{ sourceType: 'badge', sourceId: S1, exp: 3 * AWARD_XP.badgePerUnit, completedAt: day(3) }]);
  });

  it('awards badges before the trophy, and the trophy needs every unit, dated by the latest one', () => {
    const all = [...alpha, ...beta, ...gamma];
    const out = evaluateAwards(catalog, dates(all.map((u, i): [Unit, Date] => [u, day(1 + i)])), new Set());
    expect(out.map((a) => [a.sourceType, a.sourceId])).toEqual([['badge', S1], ['badge', S2], ['badge', S3], ['trophy', T1]]);
    expect(out[3]).toMatchObject({ exp: 3 * AWARD_XP.trophyPerModule, completedAt: day(9) });
  });

  it('does not let old badges stand in for a unit added later', () => {
    const grown = buildCatalog({ ...seed, concepts: { ...seed.concepts, 'kubernetes-concepts': [...seed.concepts['kubernetes-concepts'], concept('j', 'Gamma')] } }, manifest);
    const existing = new Set([`badge:${S1}`, `badge:${S2}`, `badge:${S3}`]);
    const done = dates([...alpha, ...beta, ...gamma].map((u): [Unit, Date] => [u, day(1)]));
    // everything the user had read is still read, but the new unit is not: no trophy, no repeated badge
    expect(evaluateAwards(grown, done, existing)).toEqual([]);
    done.set(unitKey(k('j')), day(5));
    expect(evaluateAwards(grown, done, existing)).toEqual([{ sourceType: 'trophy', sourceId: T1, exp: 3 * AWARD_XP.trophyPerModule, completedAt: day(5) }]);
  });

  it('never repeats an award that already exists', () => {
    const done = dates([...alpha, ...beta, ...gamma].map((u): [Unit, Date] => [u, day(1)]));
    const existing = new Set([`badge:${S1}`, `badge:${S2}`, `badge:${S3}`, `trophy:${T1}`]);
    expect(evaluateAwards(catalog, done, existing)).toEqual([]);
  });

  it('gives a one-session track only the trophy, and a direct-unit track a trophy worth 5 XP', () => {
    const done = dates([...['x', 'y', 'z'].map(j), cc('p'), cc('q')].map((u): [Unit, Date] => [u, day(2)]));
    expect(evaluateAwards(catalog, done, new Set())).toEqual([
      { sourceType: 'trophy', sourceId: T2, exp: AWARD_XP.trophyPerModule, completedAt: day(2) },
      { sourceType: 'trophy', sourceId: T3, exp: AWARD_XP.trophyPerModule, completedAt: day(2) },
    ]);
  });

  it('awards on every active track at once, with no per-track switch', () => {
    const done = dates([...alpha, ...beta, ...gamma, ...['x', 'y', 'z'].map(j), cc('p'), cc('q')].map((u): [Unit, Date] => [u, day(1)]));
    const out = evaluateAwards(catalog, done, new Set());
    expect(out.map((a) => [a.sourceType, a.sourceId])).toEqual([
      ['badge', S1], ['badge', S2], ['badge', S3], ['trophy', T1], ['trophy', T2], ['trophy', T3],
    ]);
  });

  it('never awards for a retired track or for an empty one', () => {
    const done = dates([...alpha, ...beta, ...gamma, cc('p'), cc('q')].map((u): [Unit, Date] => [u, day(1)]));
    const retired = buildCatalog(seed, [{ ...manifest[0], status: 'retired' }]);
    expect(evaluateAwards(retired, done, new Set())).toEqual([]);
    const empty = buildCatalog(seed, [{ trackId: T3, title: 'Empty', status: 'active', source: { kind: 'curriculum', module: 'foundations', discipline: 'empty' } }]);
    expect(evaluateAwards(empty, done, new Set())).toEqual([]);
  });

  it('keeps a lesson and a concept with the same id apart', () => {
    const clash = { sourceType: 'lesson', sourceId: 'kubernetes:a' } as Unit;
    expect(unitKey(clash)).not.toBe(unitKey(k('a')));
  });
});

describe('computeProgress', () => {
  const done = (units: Unit[]) => new Set(units.map(unitKey));

  it('reports partial progress and suggests the first unread unit, never gating anything', () => {
    const [k8s] = computeProgress(catalog, done([k('a'), k('b'), k('d')]), new Set());
    expect(k8s).toMatchObject({ done: 3, total: 9, complete: false, awarded: false, nextUnit: k('c') });
    expect(k8s.sessions.map((s) => [s.done, s.complete])).toEqual([[2, false], [1, false], [0, false]]);
  });

  it('shows "new since award" for added units while keeping the award', () => {
    const grown = buildCatalog({ ...seed, concepts: { ...seed.concepts, 'kubernetes-concepts': [...seed.concepts['kubernetes-concepts'], concept('j', 'Gamma')] } }, manifest);
    const everything = done(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map(k));
    const awarded = new Set([`badge:${S3}`, `trophy:${T1}`]);
    const [k8s] = computeProgress(grown, everything, awarded);
    expect(k8s).toMatchObject({ awarded: true, complete: false, newSinceAward: 1, nextUnit: k('j') });
    expect(k8s.sessions[2]).toMatchObject({ awarded: true, complete: false, newSinceAward: 1 });
    expect(k8s.sessions[0]).toMatchObject({ awarded: false, complete: true, newSinceAward: 0 });
  });

  it('lists every valid active track, and leaves out retired and invalid ones', () => {
    expect(computeProgress(catalog, new Set(), new Set()).map((t) => t.trackId)).toEqual([T1, T2, T3]);
    expect(computeProgress(buildCatalog(seed, [{ ...manifest[0], status: 'retired' }]), new Set(), new Set())).toEqual([]);
    const renamed = { ...seed, concepts: { ...seed.concepts, 'kubernetes-concepts': seed.concepts['kubernetes-concepts'].map((c) => (c.topic === 'Beta' ? { ...c, topic: 'Beta 2' } : c)) } };
    expect(computeProgress(buildCatalog(renamed, manifest), new Set(), new Set()).map((t) => t.trackId)).toEqual([T2, T3]);
  });
});

describe('describeCatalog', () => {
  const done = (units: Unit[]) => new Set(units.map(unitKey));
  const row = (sourceType: 'badge' | 'trophy', sourceId: string, updatedAt: Date) => ({ sourceType, sourceId, exp: 0, updatedAt });

  it('lists every active track with the XP each prize grants, and says which tracks have badges at all', () => {
    const [k8s, solo, direct] = describeCatalog(catalog, new Set(), []);
    expect(k8s).toMatchObject({ trackId: T1, kind: 'concepts', total: 9, done: 0, hasBadges: true, trophy: { exp: 15, awarded: false, awardedAt: null } });
    expect(k8s.sessions.map((s) => [s.title, s.total, s.exp])).toEqual([['Alpha', 3, 6], ['Beta', 3, 6], ['Gamma', 3, 6]]);
    expect(solo).toMatchObject({ hasBadges: false, trophy: { exp: 5 } });
    expect(direct).toMatchObject({ kind: 'curriculum', total: 2, hasBadges: false, sessions: [], trophy: { exp: 5 } });
  });

  it('promises exactly what evaluateAwards would grant: same prizes, same XP, for a user who finished everything', () => {
    const everything = catalog.tracks.flatMap((t) => t.units);
    const granted = evaluateAwards(catalog, dates(everything.map((u): [Unit, Date] => [u, day(1)])), new Set())
      .map((a) => `${a.sourceType}:${a.sourceId}:${a.exp}`).sort();
    const listed = describeCatalog(catalog, done(everything), []).flatMap((t) => [
      ...(t.hasBadges ? t.sessions.map((s) => `badge:${s.sessionId}:${s.exp}`) : []),
      `trophy:${t.trackId}:${t.trophy.exp}`,
    ]).sort();
    expect(listed).toEqual(granted);
  });

  it('counts progress and marks what is already earned, with its date', () => {
    const [k8s] = describeCatalog(catalog, done([k('a'), k('b')]), [row('badge', S3, day(5))]);
    expect(k8s.done).toBe(2);
    expect(k8s.sessions.map((s) => [s.done, s.awarded])).toEqual([[2, false], [0, false], [0, true]]);
    expect(k8s.sessions[2].awardedAt).toBe(day(5).toISOString());
    expect(k8s.trophy).toMatchObject({ awarded: false, awardedAt: null });
  });

  it('marks the trophy earned, with its date', () => {
    const [k8s] = describeCatalog(catalog, new Set(), [row('trophy', T1, day(7))]);
    expect(k8s.trophy).toEqual({ exp: 15, awarded: true, awardedAt: day(7).toISOString() });
  });

  it('flags a session that ends in a knowledge check', () => {
    const course = buildCatalog(seed, [{
      trackId: T1, title: 'Course', status: 'active', source: { kind: 'course', courseId: 'java-25' },
      sessions: [{ sessionId: S1, title: 'Values', label: '01-values' }],
    }]);
    expect(describeCatalog(course, new Set(), [])[0].sessions[0].hasAssessment).toBe(true);
  });

  it('leaves out retired and invalid tracks', () => {
    expect(describeCatalog(buildCatalog(seed, [{ ...manifest[0], status: 'retired' }]), new Set(), [])).toEqual([]);
    const renamed = { ...seed, concepts: { ...seed.concepts, 'kubernetes-concepts': seed.concepts['kubernetes-concepts'].map((c) => (c.topic === 'Beta' ? { ...c, topic: 'Beta 2' } : c)) } };
    expect(describeCatalog(buildCatalog(renamed, manifest), new Set(), []).map((t) => t.trackId)).toEqual([T2, T3]);
  });
});

describe('describeRequirements', () => {
  const titles = new Map<string, string>([[unitKey(k('a')), 'Title of A'], [unitKey(cc('p')), 'Title of P']]);
  const done = (units: Unit[]) => new Set(units.map(unitKey));

  it('lists each session\'s units with a title, a link and whether the user did it', () => {
    const view = describeRequirements(catalog, titles, T1, done([k('a')]))!;
    expect(view.units).toEqual([]);
    expect(view.sessions.map((s) => s.sessionId)).toEqual([S1, S2, S3]);
    expect(view.sessions[0].units[0]).toEqual({ title: 'Title of A', route: ['/kubernetes-concepts', 'a'], done: true });
    expect(view.sessions[0].units[1]).toMatchObject({ done: false, route: ['/kubernetes-concepts', 'b'] });
  });

  it('falls back to the unit id when a title is missing, so the list is never blank', () => {
    expect(describeRequirements(catalog, new Map(), T1, new Set())!.sessions[0].units[0].title).toBe('kubernetes:a');
  });

  it('puts the units of a track without sessions at the top level', () => {
    const view = describeRequirements(catalog, titles, T3, done([cc('p')]))!;
    expect(view.sessions).toEqual([]);
    expect(view.units.map((u) => [u.title, u.done])).toEqual([['Title of P', true], ['cc:foundations:discrete-math-logic:q', false]]);
    expect(view.units[0].route).toEqual(['/computer-science', 'foundations', 'discrete-math-logic', 'p']);
  });

  it('is null for an unknown, retired or invalid track', () => {
    expect(describeRequirements(catalog, titles, 'nope', new Set())).toBeNull();
    expect(describeRequirements(buildCatalog(seed, [{ ...manifest[0], status: 'retired' }]), titles, T1, new Set())).toBeNull();
  });
});

describe('published catalog (real seeds)', () => {
  const real = getCatalog();
  const byTitle = (title: string) => real.tracks.find((t) => t.title === title)!;

  it('has no manifest problem against the seeds on disk', () => {
    expect(real.problems.filter((p) => p.level === 'error')).toEqual([]);
    expect(real.tracks.every((t) => t.valid)).toBe(true);
  });

  it('Kubernetes: 10 sessions in editorial order, 50 units', () => {
    const k8s = byTitle('Kubernetes Concepts');
    expect(k8s.sessions).toHaveLength(10);
    expect(k8s.sessions[0].title).toBe('MicroK8s Cluster');
    expect(k8s.units).toHaveLength(50);
  });

  it('OCP: java-25 has 11 sessions and 91 units, java-21 has 16 and 130, and every module ends in a skill-check', () => {
    const j25 = byTitle('OCP Java SE 25 Developer Complete');
    const j21 = byTitle('OCP Java SE 21 Developer Complete');
    expect([j25.sessions.length, j25.units.length]).toEqual([11, 91]);
    expect([j21.sessions.length, j21.units.length]).toEqual([16, 130]);
    expect([...j25.sessions, ...j21.sessions].every((s) => s.hasAssessment)).toBe(true);
  });

  it('CC: one direct-unit track per reachable discipline, 38 of them', () => {
    const direct = real.tracks.filter((t) => t.source.kind === 'curriculum');
    expect(direct).toHaveLength(38);
    expect(direct.every((t) => t.sessions.length === 0 && t.units.length > 0)).toBe(true);
  });

  it('every unit id has the shape the read endpoints actually write', () => {
    const units = real.tracks.flatMap((t) => t.units);
    // the same resolvers the app uses to turn a recorded id back into a concept page
    for (const u of units.filter((x) => x.sourceType === 'concept-read')) {
      const route = parseCurriculumSourceId(u.sourceId)?.route ?? fromSourceId('concept-read', u.sourceId)?.route;
      expect(route, u.sourceId).toBeDefined();
    }
    for (const u of units.filter((x) => x.sourceType === 'lesson')) expect(u.sourceId).toMatch(/^j(21|25)-\d+-\d+[a-z]?$/);
  });

  it('waves B to E cover every concept of their module, in sessions of 3 to 12 (no warning)', () => {
    const seeds = loadSeed(MANIFEST);
    const waves: [string, string | undefined, number][] = [
      ['dotnet-concepts', undefined, 105], ['csharp-concepts', undefined, 79], ['jvm-concepts', undefined, 19],
      ['quarkus-concepts', undefined, 16], ['ruby-concepts', undefined, 29], ['rubyonrails-concepts', undefined, 19],
      ['spring-concepts', undefined, 97], ['system-design-concepts', undefined, 82], ['testing-concepts', undefined, 28],
      ['algorithms-concepts', undefined, 63], ['java-concepts', undefined, 104], ['database-concepts', undefined, 136],
    ];
    for (const [module, category, expected] of waves) {
      const tracks = real.tracks.filter((t) => t.source.kind === 'concepts' && t.source.module === module);
      const units = tracks.flatMap((t) => t.units);
      expect(units, module).toHaveLength(expected);
      expect(new Set(units.map(unitKey)).size, `${module} duplicates`).toBe(units.length);
      if (category === undefined) expect(units.length, module).toBe(seeds.concepts[module].length);
    }
    expect(real.problems.filter((p) => p.level === 'warning')).toEqual([]);
  });

  it('dotnet and csharp get one track per category, and a one-topic category (LINQ) is a trophy-only track', () => {
    const dotnetTracks = real.tracks.filter((t) => t.source.kind === 'concepts' && t.source.module === 'dotnet-concepts');
    const csharpTracks = real.tracks.filter((t) => t.source.kind === 'concepts' && t.source.module === 'csharp-concepts');
    expect(dotnetTracks).toHaveLength(6);
    expect(csharpTracks).toHaveLength(5);
    expect(byTitle('C#: LINQ').sessions).toHaveLength(1);
    expect(byTitle('C#: LINQ').units).toHaveLength(6);
  });

  it('every unit of every active track has a title, so the requirement list never shows a raw id', () => {
    const titles = getUnitTitles();
    const missing = real.tracks.filter((t) => t.valid && t.status === 'active').flatMap((t) => t.units).filter((u) => !titles.get(unitKey(u)));
    expect(missing.map((u) => u.sourceId)).toEqual([]);
  });

  it('loadSeed reads only what the manifest references', () => {
    const only = loadSeed(MANIFEST.slice(0, 1));
    expect(Object.keys(only.concepts)).toEqual(['kubernetes-concepts']);
    expect(only.courses).toEqual({});
  });
});

describe('compatProblems', () => {
  const frozen: PublishedSnapshot = {
    tracks: { [T1]: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map((s) => unitKey(k(s))) },
    sessions: { [S1]: ['a', 'b', 'c'].map((s) => unitKey(k(s))) },
  };
  const withConcepts = (list: SeedInput['concepts'][string], m = manifest) =>
    buildCatalog({ ...seed, concepts: { ...seed.concepts, 'kubernetes-concepts': list } }, m);

  it('accepts the catalog as published, and additions to it', () => {
    expect(compatProblems(frozen, catalog)).toEqual([]);
    expect(compatProblems(frozen, withConcepts([...seed.concepts['kubernetes-concepts'], concept('j', 'Alpha')]))).toEqual([]);
  });

  it('flags a unit removed from a still-active track and session', () => {
    const problems = compatProblems(frozen, withConcepts(seed.concepts['kubernetes-concepts'].filter((c) => c.slug !== 'b')));
    expect(problems).toHaveLength(2);
    expect(problems.join('\n')).toContain('lost unit concept-read kubernetes:b');
  });

  it('flags a published id deleted from the manifest instead of retired', () => {
    const problems = compatProblems(frozen, buildCatalog(seed, manifest.slice(1)));
    expect(problems.join('\n')).toContain(`track ${T1} was published but is gone from the manifest`);
    expect(problems.join('\n')).toContain(`session ${S1} was published but is gone from the manifest`);
  });

  it('lets a retired track keep its metadata without being held to its old units', () => {
    expect(compatProblems(frozen, withConcepts([concept('z', 'Zed')], [{ ...manifest[0], status: 'retired' }]))).toEqual([]);
  });
});

describe('published.json (real seeds)', () => {
  it('still covers every published unit: seeds may only grow', () => {
    const published = JSON.parse(readFileSync(join(__dirname, '../src/achievements/published.json'), 'utf-8')) as PublishedSnapshot;
    expect(Object.keys(published.tracks).length).toBeGreaterThan(0);
    expect(compatProblems(published, getCatalog())).toEqual([]);
  });
});
