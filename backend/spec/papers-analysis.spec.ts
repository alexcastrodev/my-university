import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { del, get, json, login, post, put } from './helpers';

/**
 * Live stack, like papers-discussion.spec: requests in, responses asserted. Staff roles are granted through
 * the dev-only `_test/roles` route (what someone with database access does in production), papers seeded
 * through `_test` as well.
 */
const run = Math.random().toString(36).slice(2, 8);
let paperId: number;

const KEYS = [
  'overview',
  'contribution',
  'methodology',
  'findings',
  'criticalAnalysis',
  'furtherResearch',
];
const text = (body: string) => ({ state: 'present', text: body });
/** All six sections decided: five written, one marked as not applicable. */
const complete = (tag = 'v1') => ({
  overview: text(`Overview ${tag}`),
  contribution: text(`Contribution ${tag}`),
  methodology: text(`Methodology ${tag}`),
  findings: text(`Findings ${tag}\n\nSecond paragraph`),
  criticalAnalysis: text(`Critical ${tag}`),
  furtherResearch: { state: 'not_applicable' },
});

const analysisPath = (id: number | string = paperId) => `/papers/${id}/analysis`;

async function staff(name: string, roles: string[]) {
  const user = await login(`${name}-${run}`);
  const res = await post(
    '/auth/_test/roles',
    { roles },
    { Cookie: user.cookie },
  );
  expect(res.status).toBe(201);
  return user;
}

const saveDraft = (cookie: string, sections: unknown, id?: number) =>
  put(`${analysisPath(id)}/draft`, { sections }, { Cookie: cookie });
const publish = (cookie: string, id?: number) =>
  post(`${analysisPath(id)}/publish`, {}, { Cookie: cookie });
const withdraw = (cookie: string, id?: number) =>
  post(`${analysisPath(id)}/withdraw`, {}, { Cookie: cookie });
const history = (cookie: string, id?: number) =>
  get(`${analysisPath(id)}/history`, { Cookie: cookie });
const readPublic = async (id?: number) =>
  json<{ analysis: any }>(await get(analysisPath(id)));

let curator: { id: number; cookie: string };
let editor: { id: number; cookie: string };
let reviewer: { id: number; cookie: string };
let reader: { id: number; cookie: string };

/** Another paper, removed after the run, for the tests that must not touch the main one. */
const extra: number[] = [];
async function anotherPaper(): Promise<number> {
  const res = await post('/papers/_test', {
    title: `Another analysis paper ${run} ${Math.random()}`,
    authors: [{ name: 'Grace Hopper' }],
  });
  const id = (await json<{ paper: { id: number } }>(res)).paper.id;
  extra.push(id);
  return id;
}

beforeAll(async () => {
  const res = await post('/papers/_test', {
    title: `Analysis paper ${run}`,
    authors: [{ name: 'Ada Lovelace' }],
  });
  expect(res.status).toBe(201);
  paperId = (await json<{ paper: { id: number } }>(res)).paper.id;
  curator = await staff('curator', ['paper-curator']);
  editor = await staff('editor', ['paper-curator']);
  reviewer = await staff('reviewer', ['paper-reviewer']);
  reader = await login(`reader-${run}`);
});
afterAll(async () => {
  await Promise.all([paperId, ...extra].map((id) => del(`/papers/_test/${id}`)));
});

describe('who can do what', () => {
  it('lets anyone read the analysis, and a paper without one answers null', async () => {
    const res = await get(analysisPath());
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ analysis: null });
  });

  it('answers 404 for a paper that does not exist and 400 for a malformed id', async () => {
    expect((await get(analysisPath(2147483000))).status).toBe(404);
    expect((await get(analysisPath('not-an-id'))).status).toBe(400);
  });

  it.each([
    ['history', () => get(`${analysisPath()}/history`)],
    ['saving a draft', () => put(`${analysisPath()}/draft`, { sections: {} })],
    ['publishing', () => post(`${analysisPath()}/publish`, {})],
    ['withdrawing', () => post(`${analysisPath()}/withdraw`, {})],
  ])('refuses %s without a session (401)', async (_name, call) => {
    expect((await call()).status).toBe(401);
  });

  it('refuses a plain reader on every staff route (403)', async () => {
    expect((await history(reader.cookie)).status).toBe(403);
    expect((await saveDraft(reader.cookie, complete())).status).toBe(403);
    expect((await publish(reader.cookie)).status).toBe(403);
    expect((await withdraw(reader.cookie)).status).toBe(403);
  });

  it('keeps curators to drafts and reviewers to publishing (403 across)', async () => {
    expect((await saveDraft(reviewer.cookie, complete())).status).toBe(403);
    expect((await publish(curator.cookie)).status).toBe(403);
    expect((await withdraw(curator.cookie)).status).toBe(403);
    expect((await history(curator.cookie)).status).toBe(200);
    expect((await history(reviewer.cookie)).status).toBe(200);
  });

  it('does not let a client grant itself a role through any real route', async () => {
    const res = await put(
      '/auth/settings',
      { displayName: `reader-${run}`, roles: ['paper-curator', 'paper-reviewer'] },
      { Cookie: reader.cookie },
    );
    expect(res.status).toBe(200);
    expect((await json<any>(res)).roles).toEqual([]);
    expect((await saveDraft(reader.cookie, complete())).status).toBe(403);
  });

  it('refuses to grant an unknown role', async () => {
    const res = await post(
      '/auth/_test/roles',
      { roles: ['root'] },
      { Cookie: reader.cookie },
    );
    expect(res.status).toBe(400);
  });
});

describe('what a draft accepts', () => {
  it.each([
    ['a body without sections', {}],
    ['sections that are not an object', { sections: 'text' }],
    ['an extra field next to sections', { sections: {}, status: 'published' }],
    ['an unknown section', { sections: { summary: text('x') } }],
    ['a section that is not an object', { sections: { overview: 'x' } }],
    ['an unknown field in a section', { sections: { overview: { state: 'present', text: 'x', html: 'x' } } }],
    ['an unknown state', { sections: { overview: { state: 'maybe' } } }],
    ['a missing state', { sections: { overview: { text: 'x' } } }],
    ['a present section without text', { sections: { overview: { state: 'present' } } }],
    ['a present section with blank text', { sections: { overview: { state: 'present', text: '   ' } } }],
    ['text that is not a string', { sections: { overview: { state: 'present', text: 5 } } }],
    ['text on a not applicable section', { sections: { overview: { state: 'not_applicable', text: 'why' } } }],
    ['text longer than 6000 characters', { sections: { overview: text('x'.repeat(6001)) } }],
    ['a null character', { sections: { overview: text('a\u0000b') } }],
    ['a prototype key', JSON.parse('{"sections":{"__proto__":{"state":"present","text":"x"}}}')],
  ])('rejects %s with 400', async (_name, body) => {
    const res = await put(`${analysisPath()}/draft`, body, {
      Cookie: curator.cookie,
    });
    expect(res.status).toBe(400);
  });

  it('answers 404 for a paper that does not exist', async () => {
    expect((await saveDraft(curator.cookie, complete(), 2147483000)).status).toBe(404);
  });
});

describe('the life of an analysis', () => {
  it('keeps a draft out of public sight, saves it in place and lists it in the history', async () => {
    const created = await saveDraft(curator.cookie, {
      overview: text('Secret draft overview'),
    });
    expect(created.status).toBe(200);
    expect(await json(created)).toMatchObject({
      revision: 1,
      status: 'draft',
      author: { name: `curator-${run}` },
      sections: { overview: { state: 'present', text: 'Secret draft overview' } },
    });

    const publicBody = await (await get(analysisPath())).text();
    expect(JSON.parse(publicBody)).toEqual({ analysis: null });
    expect(publicBody).not.toContain('Secret draft');
    // The paper record itself never carries the analysis either.
    expect(await (await get(`/papers/${paperId}`)).text()).not.toContain('Secret draft');

    const again = await json<any>(await saveDraft(editor.cookie, {
      overview: text('Edited draft overview'),
    }));
    expect(again).toMatchObject({ revision: 1, status: 'draft' });
    expect(again.sections.contribution).toBeUndefined();
  });

  it('refuses to publish a draft with undecided sections, naming them (422)', async () => {
    const res = await publish(reviewer.cookie);
    expect(res.status).toBe(422);
    expect(await json<any>(res)).toMatchObject({
      missing: KEYS.slice(1),
    });
    expect(await json(await get(analysisPath()))).toEqual({ analysis: null });
  });

  it('publishes a complete draft: readers see all six sections, with the states and who stands behind it', async () => {
    expect((await saveDraft(curator.cookie, complete('v1'))).status).toBe(200);
    const res = await publish(reviewer.cookie);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ revision: 1, status: 'published' });

    const { analysis } = await readPublic();
    expect(analysis).toMatchObject({
      revision: 1,
      author: { name: `curator-${run}` },
      publishedBy: { name: `reviewer-${run}` },
    });
    expect(Object.keys(analysis.sections)).toEqual(KEYS);
    expect(analysis.sections.overview).toEqual({ state: 'present', text: 'Overview v1' });
    expect(analysis.sections.findings.text).toBe('Findings v1\n\nSecond paragraph');
    expect(analysis.sections.furtherResearch).toEqual({ state: 'not_applicable', text: null });
    expect(new Date(analysis.publishedAt).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('does not expose internal ids or roles of the people it credits', async () => {
    const body = await (await get(analysisPath())).text();
    for (const leak of ['roles', 'githubLogin', 'authorId', 'publishedById', 'avatarUrl']) {
      expect(body).not.toContain(leak);
    }
  });

  it('answers 409 when there is nothing to publish or withdraw', async () => {
    expect((await publish(reviewer.cookie)).status).toBe(409);
    expect((await withdraw(reviewer.cookie, await anotherPaper())).status).toBe(409);
  });

  it('changes a published analysis through a new draft: readers keep the old one until it is published', async () => {
    const draft = await json<any>(await saveDraft(curator.cookie, complete('v2')));
    expect(draft).toMatchObject({ revision: 2, status: 'draft' });
    expect((await readPublic()).analysis.revision).toBe(1);
    expect((await readPublic()).analysis.sections.overview.text).toBe('Overview v1');

    expect((await publish(reviewer.cookie)).status).toBe(200);
    const { analysis } = await readPublic();
    expect(analysis.revision).toBe(2);
    expect(analysis.sections.overview.text).toBe('Overview v2');
  });

  it('keeps every revision in the history with one published at most, and an audit trail in order', async () => {
    const res = await json<any>(await history(reviewer.cookie));
    expect(res.revisions.map((r: any) => [r.revision, r.status])).toEqual([
      [2, 'published'],
      [1, 'superseded'],
    ]);
    expect(res.revisions[1].sections.overview.text).toBe('Overview v1');
    expect(res.events.map((e: any) => [e.revision, e.action, e.actor.name])).toEqual([
      [1, 'draft_created', `curator-${run}`],
      [1, 'draft_edited', `editor-${run}`],
      [1, 'draft_edited', `curator-${run}`],
      [1, 'published', `reviewer-${run}`],
      [2, 'draft_created', `curator-${run}`],
      [2, 'published', `reviewer-${run}`],
    ]);
  });

  it('withdraws the published analysis: readers see none, and republishing needs a new draft', async () => {
    const res = await withdraw(reviewer.cookie);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ revision: 2, status: 'withdrawn' });
    expect(await json(await get(analysisPath()))).toEqual({ analysis: null });
    expect((await publish(reviewer.cookie)).status).toBe(409);

    const hist = await json<any>(await history(curator.cookie));
    expect(hist.revisions.map((r: any) => r.status)).toEqual(['withdrawn', 'superseded']);
    expect(hist.events.at(-1)).toMatchObject({ action: 'withdrawn', actor: { name: `reviewer-${run}` } });

    expect((await saveDraft(curator.cookie, complete('v3'))).status).toBe(200);
    expect((await publish(reviewer.cookie)).status).toBe(200);
    expect((await readPublic()).analysis.revision).toBe(3);
  });

  it('ends in one draft when two curators save at the same moment', async () => {
    const second = await anotherPaper();
    const [a, b] = await Promise.all([
      saveDraft(curator.cookie, { overview: text('A') }, second),
      saveDraft(editor.cookie, { overview: text('B') }, second),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const hist = await json<any>(await history(curator.cookie, second));
    expect(hist.revisions).toHaveLength(1);
    expect(hist.revisions[0].status).toBe('draft');
    expect(hist.events.map((e: any) => e.action).sort()).toEqual(['draft_created', 'draft_edited']);
  });

  it('removes the analysis with its paper', async () => {
    const second = await anotherPaper();
    expect((await saveDraft(curator.cookie, complete(), second)).status).toBe(200);
    expect((await publish(reviewer.cookie, second)).status).toBe(200);
    expect((await del(`/papers/_test/${second}`)).status).toBe(204);
    expect((await get(analysisPath(second))).status).toBe(404);
  });
});
