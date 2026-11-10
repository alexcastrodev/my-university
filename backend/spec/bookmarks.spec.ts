import { describe, it, expect, beforeAll } from 'vitest';
import { del, get, json, login, put } from './helpers';

interface Bookmark {
  id: string;
  scope: string;
  module: string;
  discipline?: string;
  slug: string;
  title: string;
  route: string[];
  tab: 'concept' | 'lab';
}
interface State {
  bookmarks: Bookmark[];
  labDone: { module: string; discipline?: string; slug: string }[];
}

const TESTING = { module: 'testing-concepts', slug: 'junit-5-fundamentals' };
const TESTING_OTHER = { module: 'testing-concepts', slug: 'junit-5-architecture' };
const JAVA = { module: 'java-concepts', slug: 'iterator-vs-iterable' };
const CALCULUS = { module: 'foundations', discipline: 'calculus', slug: 'functions-and-the-elementary-families' };
const DISCRETE = { module: 'foundations', discipline: 'discrete-math-logic', slug: 'what-is-a-mathematical-proof' };

const state = async (cookie: string) => json<State>(await get('/bookmarks', { Cookie: cookie }));
const bookmark = (cookie: string, target: object, tab: unknown = 'concept') =>
  put('/bookmarks', { ...target, tab }, { Cookie: cookie });
const labDone = (cookie: string, target: object, done: unknown) =>
  put('/bookmarks/lab-done', { ...target, done }, { Cookie: cookie });
const inModule = (s: State, scope: string) => s.bookmarks.filter((b) => b.scope === scope);
const xp = async (cookie: string) => (await json<{ total: number }>(await get('/xp/summary', { Cookie: cookie }))).total;

describe('without a session', () => {
  it('returns 401 for every route', async () => {
    expect((await get('/bookmarks')).status).toBe(401);
    expect((await put('/bookmarks', { ...TESTING, tab: 'concept' })).status).toBe(401);
    expect((await put('/bookmarks/lab-done', { ...TESTING, done: true })).status).toBe(401);
    expect((await del('/bookmarks/0192f0a0-0000-7000-8000-000000000000')).status).toBe(401);
  });
});

describe('bookmarks', () => {
  let cookie: string;

  beforeAll(async () => {
    ({ cookie } = await login(`bookmarks-user-${Date.now()}`));
  });

  it('starts empty', async () => {
    expect(await state(cookie)).toEqual({ bookmarks: [], labDone: [] });
  });

  it('places a bookmark with the title and the route to go back to', async () => {
    const res = await bookmark(cookie, TESTING);
    expect(res.status).toBe(200);
    const [placed] = (await json<State>(res)).bookmarks;
    expect(placed).toMatchObject({
      scope: 'testing-concepts',
      module: 'testing-concepts',
      slug: TESTING.slug,
      route: ['/java/testing', TESTING.slug],
      tab: 'concept',
    });
    expect(placed.title.length).toBeGreaterThan(0);
  });

  it('moves the bookmark when another concept of the same module is marked', async () => {
    const after = await json<State>(await bookmark(cookie, TESTING_OTHER));
    const mine = inModule(after, 'testing-concepts');
    expect(mine).toHaveLength(1);
    expect(mine[0].slug).toBe(TESTING_OTHER.slug);
  });

  it('keeps one bookmark per module, independent of the others', async () => {
    const after = await json<State>(await bookmark(cookie, JAVA));
    expect(inModule(after, 'java-concepts')).toHaveLength(1);
    expect(inModule(after, 'testing-concepts')).toHaveLength(1);
  });

  it('treats each Computer Science discipline as its own module', async () => {
    await bookmark(cookie, CALCULUS);
    const after = await json<State>(await bookmark(cookie, DISCRETE));
    const calculus = inModule(after, 'cc:foundations:calculus');
    const discrete = inModule(after, 'cc:foundations:discrete-math-logic');
    expect(calculus).toHaveLength(1);
    expect(discrete).toHaveLength(1);
    expect(calculus[0]).toMatchObject({
      module: 'foundations',
      discipline: 'calculus',
      route: ['/computer-science', 'foundations', 'calculus', CALCULUS.slug],
    });
  });

  it('remembers the Lab tab and goes back to the concept tab', async () => {
    const onLab = await json<State>(await bookmark(cookie, TESTING, 'lab'));
    expect(inModule(onLab, 'testing-concepts')[0]).toMatchObject({ slug: TESTING.slug, tab: 'lab' });
    const onConcept = await json<State>(await bookmark(cookie, TESTING, 'concept'));
    expect(inModule(onConcept, 'testing-concepts')[0].tab).toBe('concept');
  });

  it('rejects a concept that does not exist, a module that does not exist and a Minute episode', async () => {
    expect((await bookmark(cookie, { module: 'testing-concepts', slug: 'no-such-concept' })).status).toBe(404);
    expect((await bookmark(cookie, { module: 'no-such-module', slug: 'x' })).status).toBe(404);
    expect((await bookmark(cookie, { module: 'foundations', discipline: 'no-such', slug: 'x' })).status).toBe(404);
    expect((await bookmark(cookie, { module: 'java-minute', slug: 'x' })).status).toBe(404);
  });

  it('rejects a malformed body', async () => {
    expect((await bookmark(cookie, TESTING, 'sideways')).status).toBe(400);
    expect((await bookmark(cookie, { module: 'testing-concepts' })).status).toBe(400);
    expect((await put('/bookmarks', {}, { Cookie: cookie })).status).toBe(400);
  });

  it('removes a bookmark by id', async () => {
    const before = await state(cookie);
    const target = inModule(before, 'java-concepts')[0];
    const res = await del(`/bookmarks/${target.id}`, { Cookie: cookie });
    expect(res.status).toBe(200);
    expect(inModule(await json<State>(res), 'java-concepts')).toHaveLength(0);
    expect((await state(cookie)).bookmarks).toHaveLength(before.bookmarks.length - 1);
  });

  it('answers 404 for an id that is not one', async () => {
    expect((await del('/bookmarks/not-an-id', { Cookie: cookie })).status).toBe(404);
  });
});

describe('finished labs', () => {
  let cookie: string;

  beforeAll(async () => {
    ({ cookie } = await login(`lab-done-user-${Date.now()}`));
  });

  it('marks a lab finished and undoes it', async () => {
    const done = await json<State>(await labDone(cookie, TESTING, true));
    expect(done.labDone).toEqual([{ module: 'testing-concepts', slug: TESTING.slug }]);
    // Marking it again changes nothing.
    expect((await json<State>(await labDone(cookie, TESTING, true))).labDone).toHaveLength(1);
    expect((await json<State>(await labDone(cookie, TESTING, false))).labDone).toEqual([]);
  });

  it('is independent of "Got it!" and of the bookmark', async () => {
    await labDone(cookie, TESTING, true);
    const concept = await json<{ read: boolean }>(await get(`/testing-concepts/${TESTING.slug}`, { Cookie: cookie }));
    expect(concept.read).toBe(false);
    expect((await state(cookie)).bookmarks).toEqual([]);
  });

  it('pays 20 XP for a finished lab, once, and does not take it back when undone', async () => {
    const { cookie: reader } = await login(`lab-xp-${Date.now()}`);
    expect(await xp(reader)).toBe(0);

    await labDone(reader, TESTING, true);
    expect(await xp(reader)).toBe(20);

    // Undoing and finishing again is the same lab: not paid twice, not refunded.
    await labDone(reader, TESTING, false);
    expect(await xp(reader)).toBe(20);
    await labDone(reader, TESTING, true);
    expect(await xp(reader)).toBe(20);

    // Another lab is worth its own.
    await labDone(reader, JAVA, true);
    expect(await xp(reader)).toBe(40);
  });

  it('pays for reading the concept and for finishing its lab separately', async () => {
    const { cookie: reader } = await login(`read-and-lab-xp-${Date.now()}`);

    expect((await put(`/testing-concepts/${TESTING.slug}/read`, {}, { Cookie: reader })).status).toBe(200);
    expect(await xp(reader)).toBe(10);
    await labDone(reader, TESTING, true);
    expect(await xp(reader)).toBe(30);
  });

  it('pays nothing for a lab that does not exist', async () => {
    const { cookie: reader } = await login(`no-lab-xp-${Date.now()}`);
    await labDone(reader, { module: 'testing-concepts', slug: 'no-such-concept' }, true);
    expect(await xp(reader)).toBe(0);
  });

  it('rejects a concept that does not exist and a flag that is not a boolean', async () => {
    expect((await labDone(cookie, { module: 'testing-concepts', slug: 'no-such-concept' }, true)).status).toBe(404);
    expect((await labDone(cookie, TESTING, 'yes')).status).toBe(400);
    expect((await labDone(cookie, { module: 'testing-concepts' }, true)).status).toBe(400);
  });
});

describe('two readers', () => {
  it('never see or touch each other\'s bookmarks and labs', async () => {
    const { cookie: ana } = await login(`bookmarks-ana-${Date.now()}`);
    const { cookie: bia } = await login(`bookmarks-bia-${Date.now()}`);

    const placed = (await json<State>(await bookmark(ana, TESTING))).bookmarks[0];
    await labDone(ana, TESTING, true);

    expect(await state(bia)).toEqual({ bookmarks: [], labDone: [] });

    // Bia cannot remove Ana's bookmark by guessing its id.
    await del(`/bookmarks/${placed.id}`, { Cookie: bia });
    expect((await state(ana)).bookmarks).toHaveLength(1);
  });
});
