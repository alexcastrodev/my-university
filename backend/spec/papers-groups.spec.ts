import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makePdf } from './pdf-fixtures';
import { AttachmentsApp, startAttachmentsApp } from './papers-attachments-app';

/**
 * Reading groups (#190). Every test is a request to the real Nest app (its own port, real database) and an
 * assertion on the response, from the side of the owner, a moderator, a member, an invitee, a reader who is not
 * in the group and a visitor with no session.
 */
const run = Math.random().toString(36).slice(2, 8);
const PAPERS = Array.from({ length: 12 }, (_, i) => ({ slug: `grp-${run}-${i + 1}`, title: `Group paper ${i + 1} ${run}` }));
const [P1, P2, P3] = PAPERS.map((p) => p.slug);

let app: AttachmentsApp;
let readers = 0;

interface Reader {
  cookie: string;
  id: number;
  /** The id of the public profile: what a group names a member by, and a way to invite. */
  profile: string;
  slug: string;
}

const send = (method: string, path: string, cookie?: string, data?: unknown) =>
  fetch(`${app.url}${path}`, {
    method,
    headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });

async function signIn(name: string, publicProfile = true): Promise<Reader> {
  const res = await fetch(`${app.url}/auth/_test/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: `${name} ${run}` }),
  });
  expect(res.status).toBe(201);
  const cookie = (res.headers.getSetCookie()[0] ?? '').split(';')[0];
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10)}-${run}-${readers++}`;
  expect((await send('PUT', '/auth/profile-slug', cookie, { slug })).status).toBe(200);
  const me = (await (await send('GET', '/auth/me', cookie)).json()) as { id: number; publicProfileId: string };
  if (!publicProfile) {
    expect((await send('PUT', '/auth/settings', cookie, { profilePublic: false })).status).toBeLessThan(300);
  }
  return { cookie, id: me.id, profile: me.publicProfileId, slug };
}

const body = async (res: Response): Promise<any> => res.json();
const g = (id: string, path = '') => `/paper-groups/${id}${path}`;

/** A group made by `owner`, with the papers on its list. */
async function group(owner: Reader, papers: string[] = [P1], name = `Reading ${run} ${readers++}`): Promise<any> {
  const res = await send('POST', '/paper-groups', owner.cookie, { name });
  expect(res.status, await res.clone().text()).toBe(201);
  const made = await body(res);
  for (const paper of papers) expect((await send('PUT', g(made.id, `/papers/${paper}`), owner.cookie)).status).toBe(200);
  return made;
}

/** Invites `who` and has them accept. */
async function join(owner: Reader, groupId: string, who: Reader): Promise<void> {
  const invited = await send('POST', g(groupId, '/invitations'), owner.cookie, { user: who.slug });
  expect(invited.status, await invited.clone().text()).toBe(201);
  const { id } = await body(invited);
  const accepted = await send('POST', `/paper-groups/invitations/${id}/accept`, who.cookie);
  expect(accepted.status, await accepted.clone().text()).toBe(201);
}

/** A group with an owner, a moderator, a member and a reader who is not in it. */
async function crowd() {
  const [owner, mod, member, outsider] = await Promise.all([signIn('Olga'), signIn('Moe'), signIn('Mia'), signIn('Otto')]);
  const made = await group(owner, [P1, P2]);
  await join(owner, made.id, mod);
  await join(owner, made.id, member);
  expect((await send('PATCH', g(made.id, `/members/${mod.profile}`), owner.cookie, { role: 'moderator' })).status).toBe(200);
  return { owner, mod, member, outsider, id: made.id as string };
}

/** A note on a public paper in the reader's library; no PDF is needed for a note. */
async function note(reader: Reader, paper: string, text = 'a thought'): Promise<any> {
  await send('POST', '/paper-library', reader.cookie, { paperId: paper });
  const res = await send('POST', `/paper-library/${paper}/annotations`, reader.cookie, { kind: 'note', body: text });
  expect(res.status, await res.clone().text()).toBe(201);
  return body(res);
}

const shareInto = (reader: Reader, paper: string, annotation: string, groups: string[]) =>
  send('PUT', `/paper-library/${paper}/annotations/${annotation}/share`, reader.cookie, { visibility: 'group', groups });

beforeAll(async () => {
  app = await startAttachmentsApp({ maxBytes: 200_000, quotaBytes: 1_000_000 }, PAPERS);
});

afterAll(async () => {
  await app.dataSource.query(`DELETE FROM "user" WHERE "displayName" LIKE $1`, [`% ${run}`]);
  await app.close();
});

describe('creating and listing groups', () => {
  it('makes the reader the owner, and lists only their own groups', async () => {
    const ana = await signIn('Ana');
    const bob = await signIn('Bob');
    const res = await send('POST', '/paper-groups', ana.cookie, { name: `  Distributed   Systems ${run} `, description: 'Thursdays' });

    expect(res.status).toBe(201);
    expect(await body(res)).toMatchObject({
      name: `Distributed Systems ${run}`,
      description: 'Thursdays',
      role: 'owner',
      memberCount: 1,
      paperCount: 0,
    });
    expect((await body(await send('GET', '/paper-groups', ana.cookie))).items.map((i: any) => i.name)).toEqual([`Distributed Systems ${run}`]);
    expect(await body(await send('GET', '/paper-groups', bob.cookie))).toEqual({ items: [] });
  });

  it('lists only the groups that have a given paper, for the share panel', async () => {
    const ana = await signIn('Ana');
    const withP1 = await group(ana, [P1], `With one ${run}`);
    await group(ana, [P2], `With two ${run}`);

    expect((await body(await send('GET', `/paper-groups?paper=${P1}`, ana.cookie))).items.map((i: any) => i.id)).toEqual([withP1.id]);
    expect((await body(await send('GET', `/paper-groups?paper=${P3}`, ana.cookie))).items).toEqual([]);
    expect((await body(await send('GET', '/paper-groups', ana.cookie))).items).toHaveLength(2);
  });

  it.each([
    ['a blank name', { name: '   ' }, 'name_required'],
    ['a name with control characters', { name: 'bad\u0007name' }, 'name_invalid'],
    ['a description with control characters', { name: 'ok', description: 'bad\u0000' }, null],
  ])('refuses %s', async (_what, data, code) => {
    const ana = await signIn('Ana');
    const res = await send('POST', '/paper-groups', ana.cookie, data);

    expect(res.status).toBe(400);
    if (code) expect(await body(res)).toMatchObject({ code });
  });

  it('refuses a field it does not know, a name that is too long and a request with no session', async () => {
    const ana = await signIn('Ana');

    expect((await send('POST', '/paper-groups', ana.cookie, { name: 'x', owner: 1 })).status).toBe(400);
    expect((await send('POST', '/paper-groups', ana.cookie, { name: 'x'.repeat(81) })).status).toBe(400);
    expect((await send('POST', '/paper-groups', undefined, { name: 'x' })).status).toBe(401);
  });

  it('stops at the number of groups one reader may own', async () => {
    process.env.PAPER_GROUPS_MAX_OWNED = '2';
    try {
      const ana = await signIn('Ana');
      await group(ana, []);
      await group(ana, []);
      const res = await send('POST', '/paper-groups', ana.cookie, { name: 'third' });

      expect(res.status).toBe(409);
      expect(await body(res)).toMatchObject({ code: 'groups_limit' });
    } finally {
      delete process.env.PAPER_GROUPS_MAX_OWNED;
    }
  });

  it('changes name and description for the owner only, and deletes the group for the owner only', async () => {
    const { owner, mod, member, outsider, id } = await crowd();

    const renamed = await send('PATCH', g(id), owner.cookie, { name: `Renamed ${run}`, description: '' });
    expect(renamed.status).toBe(200);
    expect(await body(renamed)).toMatchObject({ name: `Renamed ${run}`, description: null });
    for (const who of [mod, member]) {
      expect((await send('PATCH', g(id), who.cookie, { name: 'mine now' })).status).toBe(403);
      expect((await send('DELETE', g(id), who.cookie)).status).toBe(403);
    }
    expect((await send('PATCH', g(id), outsider.cookie, { name: 'mine now' })).status).toBe(404);
    expect((await send('DELETE', g(id), outsider.cookie)).status).toBe(404);
    expect((await send('DELETE', g(id), owner.cookie)).status).toBe(204);
    for (const who of [owner, mod, member]) expect((await send('GET', g(id), who.cookie)).status).toBe(404);
  });
});

describe('a group is private to its members', () => {
  it('answers 404, the same as for a group that does not exist, to every route a reader outside it can try', async () => {
    const { outsider, id } = await crowd();
    const missing = '0198a0a0-0000-7000-8000-000000000000';
    const routes: [string, string, unknown?][] = [
      ['GET', ''],
      ['PATCH', '', { name: 'x' }],
      ['DELETE', ''],
      ['POST', '/leave'],
      ['GET', '/papers'],
      ['PUT', `/papers/${P3}`],
      ['DELETE', `/papers/${P1}`],
      ['GET', '/posts'],
      ['POST', '/posts', { body: 'hello' }],
      ['GET', '/annotations'],
      ['GET', '/invitations'],
      ['POST', '/invitations', { user: outsider.slug }],
    ];

    for (const [method, path, data] of routes) {
      const real = await send(method, g(id, path), outsider.cookie, data);
      const none = await send(method, g(missing, path), outsider.cookie, data);
      expect([method, path, real.status]).toEqual([method, path, 404]);
      expect(await real.text()).toBe(await none.text());
    }
    expect((await send('GET', g('not-an-id'), outsider.cookie)).status).toBe(404);
  });

  it('shows members who is in the group, by what their public profile publishes', async () => {
    const { owner, mod, member, id } = await crowd();
    const res = await send('GET', g(id), member.cookie);

    expect(res.status).toBe(200);
    const detail = await body(res);
    expect(detail.group).toMatchObject({ id, role: 'member', memberCount: 3, paperCount: 2 });
    expect(detail.members.map((m: any) => [m.role, m.you])).toEqual([['owner', false], ['moderator', false], ['member', true]]);
    expect(detail.members[0]).toMatchObject({ id: owner.profile, name: `Olga ${run}`, profile: owner.slug });
    expect(detail.members[1].id).toBe(mod.profile);
    // Nothing internal: no numeric user id, no email.
    expect(JSON.stringify(detail)).not.toMatch(/"userId"|email/i);
  });

  it('is never cached: the answer depends on who asks', async () => {
    const { owner, id } = await crowd();
    expect((await send('GET', g(id), owner.cookie)).headers.get('cache-control')).toBe('no-store');
  });
});

describe('invitations', () => {
  it('invites by vanity slug, by profile id and by the /u/ link, and the invitee sees it with the group name', async () => {
    const owner = await signIn('Olga');
    const [a, b, c] = await Promise.all([signIn('Ada'), signIn('Bea'), signIn('Cleo')]);
    const made = await group(owner);

    for (const [who, user] of [[a, a.slug], [b, b.profile], [c, `https://university.kurz.fyi/u/${c.slug}`]] as const) {
      const res = await send('POST', g(made.id, '/invitations'), owner.cookie, { user });
      expect(res.status, user).toBe(201);
      expect(await body(res)).toMatchObject({ invitee: { id: who.profile } });
    }
    const mine = await body(await send('GET', '/paper-groups/invitations', a.cookie));
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]).toMatchObject({ group: { id: made.id, name: made.name }, invitedBy: { id: owner.profile, name: `Olga ${run}` } });
    expect((await body(await send('GET', g(made.id, '/invitations'), owner.cookie))).items).toHaveLength(3);
  });

  it('does not tell a name nobody has from a profile that is not public', async () => {
    const owner = await signIn('Olga');
    const hidden = await signIn('Hidden', false);
    const made = await group(owner);

    const unknown = await send('POST', g(made.id, '/invitations'), owner.cookie, { user: `nobody-${run}` });
    const notPublic = await send('POST', g(made.id, '/invitations'), owner.cookie, { user: hidden.slug });

    expect(unknown.status).toBe(400);
    expect(notPublic.status).toBe(400);
    expect(await body(unknown)).toMatchObject({ code: 'invitee_not_found' });
    expect(await body(notPublic)).toMatchObject({ code: 'invitee_not_found' });
  });

  it('refuses inviting yourself, someone already in, someone already invited, and a full group', async () => {
    const owner = await signIn('Olga');
    const [a, b, c] = await Promise.all([signIn('Ada'), signIn('Bea'), signIn('Cleo')]);
    process.env.PAPER_GROUP_MEMBERS_MAX = '3';
    try {
      const made = await group(owner);

      expect(await body(await send('POST', g(made.id, '/invitations'), owner.cookie, { user: owner.slug }))).toMatchObject({ code: 'invitee_is_you' });
      await join(owner, made.id, a);
      expect(await send('POST', g(made.id, '/invitations'), owner.cookie, { user: a.slug })).toMatchObject({ status: 409 });
      expect(await body(await send('POST', g(made.id, '/invitations'), owner.cookie, { user: a.slug }))).toMatchObject({ code: 'already_member' });
      expect((await send('POST', g(made.id, '/invitations'), owner.cookie, { user: b.slug })).status).toBe(201);
      expect(await body(await send('POST', g(made.id, '/invitations'), owner.cookie, { user: b.slug }))).toMatchObject({ code: 'already_invited' });
      // Members (2) and the invitation waiting (1) fill the group: a third reader cannot be asked.
      const full = await send('POST', g(made.id, '/invitations'), owner.cookie, { user: c.slug });
      expect(full.status).toBe(409);
      expect(await body(full)).toMatchObject({ code: 'group_full' });
    } finally {
      delete process.env.PAPER_GROUP_MEMBERS_MAX;
    }
  });

  it('does not let one reader be flooded with invitations', async () => {
    const [target, o1, o2] = await Promise.all([signIn('Target'), signIn('Olga'), signIn('Oscar')]);
    process.env.PAPER_GROUP_INBOX_MAX = '1';
    try {
      expect((await send('POST', g((await group(o1)).id, '/invitations'), o1.cookie, { user: target.slug })).status).toBe(201);
      const second = await send('POST', g((await group(o2)).id, '/invitations'), o2.cookie, { user: target.slug });

      expect(second.status).toBe(409);
      expect(await body(second)).toMatchObject({ code: 'invitee_inbox_full' });
    } finally {
      delete process.env.PAPER_GROUP_INBOX_MAX;
    }
  });

  it('makes the invitee a plain member when they accept, and only they can answer', async () => {
    const owner = await signIn('Olga');
    const [ada, eve] = await Promise.all([signIn('Ada'), signIn('Eve')]);
    const made = await group(owner);
    const { id } = await body(await send('POST', g(made.id, '/invitations'), owner.cookie, { user: ada.slug }));

    expect((await send('POST', `/paper-groups/invitations/${id}/accept`, eve.cookie)).status).toBe(404);
    expect((await send('DELETE', `/paper-groups/invitations/${id}`, eve.cookie)).status).toBe(404);
    expect((await send('GET', g(made.id), ada.cookie)).status).toBe(404);

    const accepted = await send('POST', `/paper-groups/invitations/${id}/accept`, ada.cookie);
    expect(accepted.status).toBe(201);
    expect(await body(accepted)).toMatchObject({ id: made.id, role: 'member', memberCount: 2 });
    expect((await body(await send('GET', '/paper-groups/invitations', ada.cookie))).items).toEqual([]);
    expect((await send('POST', `/paper-groups/invitations/${id}/accept`, ada.cookie)).status).toBe(404);
  });

  it('lets the invitee decline, and the owner or a moderator take an invitation back', async () => {
    const { owner, mod, member, id } = await crowd();
    const [a, b, c] = await Promise.all([signIn('Ada'), signIn('Bea'), signIn('Cleo')]);
    const invite = async (who: Reader, by: Reader) => (await body(await send('POST', g(id, '/invitations'), by.cookie, { user: who.slug }))).id as string;

    const declined = await invite(a, owner);
    expect((await send('DELETE', `/paper-groups/invitations/${declined}`, a.cookie)).status).toBe(204);
    expect((await send('GET', g(id), a.cookie)).status).toBe(404);

    const byMod = await invite(b, mod);
    expect((await send('DELETE', g(id, `/invitations/${byMod}`), member.cookie)).status).toBe(403);
    expect((await send('DELETE', g(id, `/invitations/${byMod}`), owner.cookie)).status).toBe(204);
    expect((await send('POST', `/paper-groups/invitations/${byMod}/accept`, b.cookie)).status).toBe(404);

    const again = await invite(c, mod);
    expect((await send('DELETE', g(id, `/invitations/${again}`), mod.cookie)).status).toBe(204);
    expect((await send('DELETE', g(id, `/invitations/${again}`), mod.cookie)).status).toBe(404);
  });

  it('is for those who manage the group: a plain member can neither invite nor see who is invited', async () => {
    const { member, id } = await crowd();
    const [ada] = [await signIn('Ada')];

    expect((await send('POST', g(id, '/invitations'), member.cookie, { user: ada.slug })).status).toBe(403);
    expect((await send('GET', g(id, '/invitations'), member.cookie)).status).toBe(403);
  });

  it('does not let a moderator get past the size of the group by accepting late', async () => {
    const owner = await signIn('Olga');
    const [a, b] = await Promise.all([signIn('Ada'), signIn('Bea')]);
    const made = await group(owner);
    const first = (await body(await send('POST', g(made.id, '/invitations'), owner.cookie, { user: a.slug }))).id;
    const second = (await body(await send('POST', g(made.id, '/invitations'), owner.cookie, { user: b.slug }))).id;
    process.env.PAPER_GROUP_MEMBERS_MAX = '2';
    try {
      expect((await send('POST', `/paper-groups/invitations/${first}/accept`, a.cookie)).status).toBe(201);
      const late = await send('POST', `/paper-groups/invitations/${second}/accept`, b.cookie);
      expect(late.status).toBe(409);
      expect(await body(late)).toMatchObject({ code: 'group_full' });
    } finally {
      delete process.env.PAPER_GROUP_MEMBERS_MAX;
    }
  });
});

describe('roles and permissions', () => {
  it('lets the owner make a member a moderator and back, and nobody else', async () => {
    const { owner, mod, member, outsider, id } = await crowd();

    const demoted = await send('PATCH', g(id, `/members/${mod.profile}`), owner.cookie, { role: 'member' });
    expect(demoted.status).toBe(200);
    expect(await body(demoted)).toMatchObject({ id: mod.profile, role: 'member' });
    expect((await send('PATCH', g(id, `/members/${member.profile}`), owner.cookie, { role: 'moderator' })).status).toBe(200);
    expect((await send('PATCH', g(id, `/members/${mod.profile}`), member.cookie, { role: 'moderator' })).status).toBe(403);
    expect((await send('PATCH', g(id, `/members/${mod.profile}`), outsider.cookie, { role: 'moderator' })).status).toBe(404);
  });

  it('keeps the owner as the owner, and refuses a role that is not given', async () => {
    const { owner, mod, id } = await crowd();

    expect(await body(await send('PATCH', g(id, `/members/${owner.profile}`), owner.cookie, { role: 'member' }))).toMatchObject({ code: 'owner_role_fixed' });
    expect((await send('PATCH', g(id, `/members/${mod.profile}`), owner.cookie, { role: 'owner' })).status).toBe(400);
    expect((await send('PATCH', g(id, `/members/${mod.profile}`), owner.cookie, { role: 'king' })).status).toBe(400);
    expect((await send('PATCH', g(id, `/members/not-an-id`), owner.cookie, { role: 'member' })).status).toBe(404);
  });

  it('lets a moderator remove plain members but not another moderator or the owner', async () => {
    const { owner, mod, member, id } = await crowd();
    const other = await signIn('Mo2');
    await join(owner, id, other);
    expect((await send('PATCH', g(id, `/members/${other.profile}`), owner.cookie, { role: 'moderator' })).status).toBe(200);

    expect((await send('DELETE', g(id, `/members/${other.profile}`), mod.cookie)).status).toBe(403);
    expect((await send('DELETE', g(id, `/members/${owner.profile}`), mod.cookie)).status).toBe(403);
    expect((await send('DELETE', g(id, `/members/${member.profile}`), mod.cookie)).status).toBe(204);
    expect((await send('GET', g(id), member.cookie)).status).toBe(404);
    // The owner can remove a moderator.
    expect((await send('DELETE', g(id, `/members/${other.profile}`), owner.cookie)).status).toBe(204);
  });

  it('does not let a plain member remove anyone, and sends a member who wants out to "leave"', async () => {
    const { owner, mod, member, id } = await crowd();

    expect((await send('DELETE', g(id, `/members/${mod.profile}`), member.cookie)).status).toBe(403);
    expect(await body(await send('DELETE', g(id, `/members/${owner.profile}`), owner.cookie))).toMatchObject({ code: 'use_leave' });
    expect((await send('DELETE', g(id, `/members/${'0198a0a0-0000-7000-8000-000000000000'}`), owner.cookie)).status).toBe(404);
  });

  it('lets a member leave, and not the owner', async () => {
    const { owner, member, id } = await crowd();

    const refused = await send('POST', g(id, '/leave'), owner.cookie);
    expect(refused.status).toBe(409);
    expect(await body(refused)).toMatchObject({ code: 'owner_cannot_leave' });
    expect((await send('POST', g(id, '/leave'), member.cookie)).status).toBe(204);
    expect((await body(await send('GET', '/paper-groups', member.cookie))).items).toEqual([]);
    expect((await body(await send('GET', g(id), owner.cookie))).group.memberCount).toBe(2);
  });

  it('puts only the permitted members through the paper list: owner and moderator curate, members read', async () => {
    const { owner, mod, member, id } = await crowd();

    expect((await send('PUT', g(id, `/papers/${P3}`), member.cookie)).status).toBe(403);
    expect((await send('DELETE', g(id, `/papers/${P1}`), member.cookie)).status).toBe(403);
    expect((await send('PUT', g(id, `/papers/${P3}`), mod.cookie)).status).toBe(200);
    expect((await body(await send('GET', g(id, '/papers'), member.cookie))).items.map((p: any) => p.id)).toEqual([P1, P2, P3]);
    expect((await send('DELETE', g(id, `/papers/${P3}`), owner.cookie)).status).toBe(204);
  });
});

describe('the paper list', () => {
  it('holds public papers: a private paper and a paper that does not exist cannot be added', async () => {
    const owner = await signIn('Olga');
    const made = await group(owner, []);
    const mine = await body(await send('POST', '/paper-library/manual', owner.cookie, { title: `Private ${run}`, authors: [{ name: 'Ada' }], publicationDate: '2020' }));

    const privateRes = await send('PUT', g(made.id, `/papers/${mine.paperId}`), owner.cookie);
    expect(privateRes.status).toBe(400);
    expect(await body(privateRes)).toMatchObject({ code: 'private_paper' });
    expect((await send('PUT', g(made.id, '/papers/no-such-paper'), owner.cookie)).status).toBe(404);
    expect((await send('PUT', g(made.id, '/papers/Not%20A%20Slug'), owner.cookie)).status).toBe(404);
  });

  it('adds a paper once, whatever the number of requests, and answers in the language asked', async () => {
    const owner = await signIn('Olga');
    const made = await group(owner, []);

    const first = await send('PUT', g(made.id, `/papers/${P1}`), owner.cookie);
    const second = await send('PUT', g(made.id, `/papers/${P1}`), owner.cookie);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await body(first)).toMatchObject({ id: P1, title: PAPERS[0].title, sharedCount: 0, addedBy: `Olga ${run}` });
    expect((await body(await send('GET', g(made.id, '/papers'), owner.cookie))).items).toHaveLength(1);
    expect((await body(await send('GET', g(made.id), owner.cookie))).group.paperCount).toBe(1);
  });

  it('stops at the number of papers a group lists', async () => {
    process.env.PAPER_GROUP_PAPERS_MAX = '2';
    try {
      const owner = await signIn('Olga');
      const made = await group(owner, [P1, P2]);
      const res = await send('PUT', g(made.id, `/papers/${P3}`), owner.cookie);

      expect(res.status).toBe(409);
      expect(await body(res)).toMatchObject({ code: 'papers_limit' });
      // Adding one that is already there is not "one more".
      expect((await send('PUT', g(made.id, `/papers/${P1}`), owner.cookie)).status).toBe(200);
    } finally {
      delete process.env.PAPER_GROUP_PAPERS_MAX;
    }
  });
});

describe('the board of the group', () => {
  it('lets members post, newest first, with who wrote it and what each may remove', async () => {
    const { owner, mod, member, id } = await crowd();

    const first = await send('POST', g(id, '/posts'), member.cookie, { body: '  What is the quorum?  ' });
    expect(first.status).toBe(201);
    expect(await body(first)).toMatchObject({ body: 'What is the quorum?', paper: null, mine: true, canRemove: true, author: { id: member.profile } });
    expect((await send('POST', g(id, '/posts'), owner.cookie, { body: 'A majority.', paper: P1 })).status).toBe(201);

    const seen = await body(await send('GET', g(id, '/posts'), mod.cookie));
    expect(seen.items.map((p: any) => [p.body, p.paper, p.mine, p.canRemove])).toEqual([['A majority.', P1, false, true], ['What is the quorum?', null, false, true]]);
    const asMember = await body(await send('GET', g(id, '/posts'), member.cookie));
    expect(asMember.items.map((p: any) => p.canRemove)).toEqual([false, true]);
    expect((await body(await send('GET', g(id, `/posts?paper=${P1}`), mod.cookie))).items).toHaveLength(1);
  });

  it('refuses an empty post, a post about a paper that is not on the list, a post from outside and one with no session', async () => {
    const { member, outsider, id } = await crowd();

    expect(await body(await send('POST', g(id, '/posts'), member.cookie, { body: '   ' }))).toMatchObject({ code: 'body_required' });
    expect(await body(await send('POST', g(id, '/posts'), member.cookie, { body: 'x', paper: P3 }))).toMatchObject({ code: 'paper_not_in_group' });
    expect((await send('POST', g(id, '/posts'), member.cookie, { body: 'x'.repeat(5001) })).status).toBe(400);
    expect((await send('POST', g(id, '/posts'), outsider.cookie, { body: 'x' })).status).toBe(404);
    expect((await send('POST', g(id, '/posts'), undefined, { body: 'x' })).status).toBe(401);
  });

  it('stores a post as typed and sends it back as text, never as markup to run', async () => {
    const { member, id } = await crowd();
    const text = '<script>alert(1)</script> **bold**';

    expect((await send('POST', g(id, '/posts'), member.cookie, { body: text })).status).toBe(201);
    const [post] = (await body(await send('GET', g(id, '/posts'), member.cookie))).items;
    expect(post.body).toBe(text);
    expect((await send('GET', g(id, '/posts'), member.cookie)).headers.get('content-type')).toContain('application/json');
  });

  it('slows a reader who posts too fast', async () => {
    process.env.PAPER_GROUP_POSTS_PER_MINUTE = '3';
    try {
      const { member, id } = await crowd();
      for (let i = 0; i < 3; i++) expect((await send('POST', g(id, '/posts'), member.cookie, { body: `post ${i}` })).status).toBe(201);
      const res = await send('POST', g(id, '/posts'), member.cookie, { body: 'one more' });

      expect(res.status).toBe(429);
      expect(await body(res)).toMatchObject({ code: 'too_many_posts' });
    } finally {
      delete process.env.PAPER_GROUP_POSTS_PER_MINUTE;
    }
  });

  it('pages through the posts by the id of the last one seen', async () => {
    const { owner, id } = await crowd();
    process.env.PAPER_GROUP_POSTS_PER_MINUTE = '100';
    try {
      for (let i = 1; i <= 52; i++) expect((await send('POST', g(id, '/posts'), owner.cookie, { body: `n${i}` })).status).toBe(201);
      const one = await body(await send('GET', g(id, '/posts'), owner.cookie));
      const two = await body(await send('GET', g(id, `/posts?before=${one.next}`), owner.cookie));

      expect(one.items).toHaveLength(50);
      expect(one.items[0].body).toBe('n52');
      expect(two.items.map((p: any) => p.body)).toEqual(['n2', 'n1']);
      expect(two.next).toBeNull();
      expect((await send('GET', g(id, '/posts?before=nope'), owner.cookie)).status).toBe(400);
    } finally {
      delete process.env.PAPER_GROUP_POSTS_PER_MINUTE;
    }
  });

  it('lets the author, a moderator and the owner take a post down, and no other member', async () => {
    const { owner, mod, member, id } = await crowd();
    const peer = await signIn('Pia');
    await join(owner, id, peer);
    const post = async (who: Reader) => (await body(await send('POST', g(id, '/posts'), who.cookie, { body: 'to go' }))).id as string;

    const mine = await post(member);
    expect((await send('DELETE', g(id, `/posts/${mine}`), peer.cookie)).status).toBe(404);
    expect((await send('DELETE', g(id, `/posts/${mine}`), member.cookie)).status).toBe(204);
    const second = await post(member);
    expect((await send('DELETE', g(id, `/posts/${second}`), mod.cookie)).status).toBe(204);
    const third = await post(peer);
    expect((await send('DELETE', g(id, `/posts/${third}`), owner.cookie)).status).toBe(204);
    expect((await send('DELETE', g(id, `/posts/${third}`), owner.cookie)).status).toBe(404);
    expect((await body(await send('GET', g(id, '/posts'), owner.cookie))).items).toEqual([]);
  });

  it('does not reach into another group by the id of its post', async () => {
    const { owner, id } = await crowd();
    const elsewhere = await signIn('Eli');
    const other = await group(elsewhere);
    const post = (await body(await send('POST', g(other.id, '/posts'), elsewhere.cookie, { body: 'private to that group' }))).id;

    // The owner of the first group asks to remove a post of the second, through their own group's url.
    expect((await send('DELETE', g(id, `/posts/${post}`), owner.cookie)).status).toBe(404);
    expect((await body(await send('GET', g(other.id, '/posts'), elsewhere.cookie))).items).toHaveLength(1);
  });
});

describe('annotations shared into a group', () => {
  it('shares into the groups the reader is in, with the author attributed and nothing of the private side', async () => {
    const { owner, member, id } = await crowd();
    const mine = await note(member, P1, 'the quorum is a majority');

    const shared = await shareInto(member, P1, mine.id, [id]);
    expect(shared.status, await shared.clone().text()).toBe(200);
    expect(await body(shared)).toMatchObject({ visibility: 'group', groups: [{ id, name: expect.any(String) }], recipients: [] });

    const seen = await body(await send('GET', g(id, '/annotations'), owner.cookie));
    expect(seen.items).toHaveLength(1);
    expect(seen.items[0]).toMatchObject({
      paper: P1,
      kind: 'note',
      body: 'the quorum is a majority',
      author: { id: member.profile, name: `Mia ${run}`, profile: member.slug },
      mine: false,
      canRemove: true,
    });
    // A copy of a few words: no way back to the library entry, the file or its geometry.
    expect(Object.keys(seen.items[0]).sort()).toEqual(['author', 'body', 'canRemove', 'id', 'kind', 'mine', 'page', 'paper', 'quote', 'sharedAt']);
    expect((await body(await send('GET', g(id, '/papers'), owner.cookie))).items.find((p: any) => p.id === P1).sharedCount).toBe(1);
    expect((await body(await send('GET', g(id, `/annotations?paper=${P2}`), owner.cookie))).items).toEqual([]);
  });

  it('is only for a group the reader is in, and for a paper on its list', async () => {
    const { member, outsider, id } = await crowd();
    const other = await group(await signIn('Eli'));
    const mine = await note(member, P1);
    const onP3 = await note(member, P3);

    expect(await body(await shareInto(member, P1, mine.id, [other.id]))).toMatchObject({ code: 'group_not_found' });
    expect(await body(await shareInto(member, P1, mine.id, ['0198a0a0-0000-7000-8000-000000000000']))).toMatchObject({ code: 'group_not_found' });
    expect(await body(await shareInto(member, P3, onP3.id, [id]))).toMatchObject({ code: 'paper_not_in_group' });
    expect((await shareInto(outsider, P1, (await note(outsider, P1)).id, [id])).status).toBe(400);
    expect((await body(await send('GET', g(id, '/annotations'), member.cookie))).items).toEqual([]);
  });

  it('asks for groups on a group share, and refuses them on any other', async () => {
    const { member, id } = await crowd();
    const mine = await note(member, P1);
    const put = (data: object) => send('PUT', `/paper-library/${P1}/annotations/${mine.id}/share`, member.cookie, data);

    expect(await body(await put({ visibility: 'group' }))).toMatchObject({ code: 'groups_required' });
    expect(await body(await put({ visibility: 'public', groups: [id] }))).toMatchObject({ code: 'groups_only_for_group' });
    expect(await body(await put({ visibility: 'group', groups: [id], recipients: ['x'] }))).toMatchObject({ code: 'recipients_only_for_users' });
    expect((await put({ visibility: 'group', groups: ['nope'] })).status).toBe(400);
    expect((await put({ visibility: 'group', groups: Array(6).fill(id) })).status).toBe(400);
  });

  it('stays out of the paper page: only members see it, and only in the group', async () => {
    const { member, outsider, id } = await crowd();
    const mine = await note(member, P1, 'for the group only');
    expect((await shareInto(member, P1, mine.id, [id])).status).toBe(200);

    for (const cookie of [undefined, member.cookie, outsider.cookie]) {
      const seen = await body(await send('GET', `/papers/${P1}/shared-annotations`, cookie));
      expect(seen.items, String(cookie)).toEqual([]);
    }
    expect((await send('GET', g(id, '/annotations'), outsider.cookie)).status).toBe(404);
  });

  it('can be taken out of the group by its author, a moderator or the owner, and not by another member', async () => {
    const { owner, mod, member, id } = await crowd();
    const peer = await signIn('Pia');
    await join(owner, id, peer);
    const shared = async (text: string) => {
      const n = await note(member, P1, text);
      expect((await shareInto(member, P1, n.id, [id])).status).toBe(200);
      return (await body(await send('GET', g(id, '/annotations'), owner.cookie))).items.find((i: any) => i.body === text).id as string;
    };

    const a = await shared('one');
    expect((await send('DELETE', g(id, `/annotations/${a}`), peer.cookie)).status).toBe(404);
    expect((await send('DELETE', g(id, `/annotations/${a}`), member.cookie)).status).toBe(204);
    const b = await shared('two');
    expect((await send('DELETE', g(id, `/annotations/${b}`), mod.cookie)).status).toBe(204);
    const c = await shared('three');
    expect((await send('DELETE', g(id, `/annotations/${c}`), owner.cookie)).status).toBe(204);
    expect((await send('DELETE', g(id, `/annotations/${c}`), owner.cookie)).status).toBe(404);
    expect((await body(await send('GET', g(id, '/annotations'), owner.cookie))).items).toEqual([]);
    // The private notes are still there.
    expect((await body(await send('GET', `/paper-library/${P1}/annotations`, member.cookie))).items.map((i: any) => i.body).sort()).toEqual(['one', 'three', 'two']);
  });

  it('keeps the author in control: sharing again with another audience takes it out of the group', async () => {
    const { owner, member, id } = await crowd();
    const mine = await note(member, P1, 'moves on');
    expect((await shareInto(member, P1, mine.id, [id])).status).toBe(200);

    const again = await send('PUT', `/paper-library/${P1}/annotations/${mine.id}/share`, member.cookie, { visibility: 'users', recipients: [owner.slug] });
    expect(again.status).toBe(200);
    expect(await body(again)).toMatchObject({ visibility: 'users', groups: [] });
    expect((await body(await send('GET', g(id, '/annotations'), owner.cookie))).items).toEqual([]);

    expect((await shareInto(member, P1, mine.id, [id])).status).toBe(200);
    expect((await send('DELETE', `/paper-library/${P1}/annotations/${mine.id}/share`, member.cookie)).status).toBe(204);
    expect((await body(await send('GET', g(id, '/annotations'), owner.cookie))).items).toEqual([]);
  });

  it('shows the author which groups an annotation is in', async () => {
    const owner = await signIn('Olga');
    const a = await group(owner, [P1], `Alpha ${run}`);
    const b = await group(owner, [P1], `Beta ${run}`);
    const mine = await note(owner, P1);
    expect((await shareInto(owner, P1, mine.id, [b.id, a.id])).status).toBe(200);

    const listed = await body(await send('GET', `/paper-library/${P1}/annotations`, owner.cookie));
    expect(listed.items.find((i: any) => i.id === mine.id).share).toMatchObject({ visibility: 'group', groups: [{ id: a.id, name: a.name }, { id: b.id, name: b.name }] });
  });

  it('is withdrawn when the member leaves or is removed, and the private annotation stays', async () => {
    const { owner, mod, member, id } = await crowd();
    const peer = await signIn('Pia');
    await join(owner, id, peer);
    const mine = await note(member, P1, 'leaving soon');
    const theirs = await note(peer, P1, 'being removed');
    expect((await shareInto(member, P1, mine.id, [id])).status).toBe(200);
    expect((await shareInto(peer, P1, theirs.id, [id])).status).toBe(200);
    expect((await body(await send('GET', g(id, '/annotations'), owner.cookie))).items).toHaveLength(2);

    expect((await send('POST', g(id, '/leave'), member.cookie)).status).toBe(204);
    expect((await body(await send('GET', g(id, '/annotations'), owner.cookie))).items.map((i: any) => i.body)).toEqual(['being removed']);
    expect((await send('DELETE', g(id, `/members/${peer.profile}`), mod.cookie)).status).toBe(204);
    expect((await body(await send('GET', g(id, '/annotations'), owner.cookie))).items).toEqual([]);

    for (const [who, text, annotation] of [[member, 'leaving soon', mine.id], [peer, 'being removed', theirs.id]] as const) {
      const own = (await body(await send('GET', `/paper-library/${P1}/annotations`, who.cookie))).items.find((i: any) => i.id === annotation);
      expect(own).toMatchObject({ body: text, share: null });
    }
    // Neither still has a share row that nobody could see.
    const left = await app.dataSource.query(`SELECT count(*)::int AS n FROM paper_annotation_share WHERE "annotationId" = ANY($1::uuid[])`, [[mine.id, theirs.id]]);
    expect(left[0].n).toBe(0);
  });

  it('is withdrawn when its paper leaves the group list, and with the group when it is deleted', async () => {
    const { owner, member, id } = await crowd();
    const first = await note(member, P1, 'on p1');
    const second = await note(member, P2, 'on p2');
    expect((await shareInto(member, P1, first.id, [id])).status).toBe(200);
    expect((await shareInto(member, P2, second.id, [id])).status).toBe(200);

    expect((await send('DELETE', g(id, `/papers/${P1}`), owner.cookie)).status).toBe(204);
    expect((await body(await send('GET', g(id, '/annotations'), owner.cookie))).items.map((i: any) => i.body)).toEqual(['on p2']);

    expect((await send('DELETE', g(id), owner.cookie)).status).toBe(204);
    const left = await app.dataSource.query(`SELECT count(*)::int AS n FROM paper_annotation_share WHERE "annotationId" = ANY($1::uuid[])`, [[first.id, second.id]]);
    expect(left[0].n).toBe(0);
    expect((await body(await send('GET', `/paper-library/${P2}/annotations`, member.cookie))).items[0]).toMatchObject({ body: 'on p2', share: null });
  });

  it('keeps the other audiences of a share when one group lets it go', async () => {
    const owner = await signIn('Olga');
    const a = await group(owner, [P1], `Alpha ${run}`);
    const b = await group(owner, [P1], `Beta ${run}`);
    const mine = await note(owner, P1, 'in two groups');
    expect((await shareInto(owner, P1, mine.id, [a.id, b.id])).status).toBe(200);

    expect((await send('DELETE', g(a.id), owner.cookie)).status).toBe(204);
    expect((await body(await send('GET', g(b.id, '/annotations'), owner.cookie))).items.map((i: any) => i.body)).toEqual(['in two groups']);
    const share = (await body(await send('GET', `/paper-library/${P1}/annotations`, owner.cookie))).items[0].share;
    expect(share.groups).toEqual([{ id: b.id, name: b.name }]);
  });
});

describe('what a group never reaches', () => {
  it('gives no access to a member\'s library, notes, or PDF, only to what they chose to share', async () => {
    const { owner, member, id } = await crowd();
    await note(member, P1, 'private thought');
    const upload = await fetch(`${app.url}/papers/${P1}/attachment`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf', Cookie: member.cookie },
      body: makePdf({ padding: 1 }) as BodyInit,
    });
    expect(upload.status).toBe(201);

    // The owner has the same paper on the group list and still no way to the member's notes or file.
    expect((await send('GET', `/paper-library/${P1}/annotations`, owner.cookie)).status).toBe(404);
    expect((await send('GET', `/papers/${P1}/attachment`, owner.cookie)).status).toBe(404);
    expect((await send('GET', `/papers/${P1}/attachment/file`, owner.cookie)).status).toBe(404);
    expect((await send('GET', `/papers/${P1}/attachment/file`, member.cookie)).status).toBe(200);
    expect((await body(await send('GET', g(id, '/annotations'), owner.cookie))).items).toEqual([]);
    expect(JSON.stringify(await body(await send('GET', g(id), owner.cookie)))).not.toContain('private thought');
  });

  it('leaves a member\'s library, notes and other papers as they were when they leave', async () => {
    const { member, id } = await crowd();
    const mine = await note(member, P1, 'mine to keep');

    expect((await send('POST', g(id, '/leave'), member.cookie)).status).toBe(204);
    const library = await body(await send('GET', '/paper-library', member.cookie));
    expect(library.items.map((i: any) => i.id)).toContain(P1);
    expect((await body(await send('GET', `/paper-library/${P1}/annotations`, member.cookie))).items.map((i: any) => i.id)).toEqual([mine.id]);
    expect((await send('GET', g(id, '/papers'), member.cookie)).status).toBe(404);
    expect((await send('GET', g(id, '/posts'), member.cookie)).status).toBe(404);
    expect((await send('GET', g(id, '/annotations'), member.cookie)).status).toBe(404);
  });

  it('stops all access at once when a member is removed, including what they could read a moment ago', async () => {
    const { owner, member, id } = await crowd();
    expect((await send('GET', g(id, '/posts'), member.cookie)).status).toBe(200);
    expect((await send('DELETE', g(id, `/members/${member.profile}`), owner.cookie)).status).toBe(204);

    for (const path of ['', '/papers', '/posts', '/annotations']) expect((await send('GET', g(id, path), member.cookie)).status, path).toBe(404);
    expect((await send('POST', g(id, '/posts'), member.cookie, { body: 'still here?' })).status).toBe(404);
  });

  it('takes a member out of every group when their account goes, and the group goes with its owner', async () => {
    const owner = await signIn('Olga');
    const member = await signIn('Mia');
    const made = await group(owner);
    await join(owner, made.id, member);
    expect((await send('POST', g(made.id, '/posts'), member.cookie, { body: 'bye' })).status).toBe(201);

    await app.dataSource.query(`DELETE FROM "user" WHERE id = $1`, [member.id]);
    expect((await body(await send('GET', g(made.id), owner.cookie))).group.memberCount).toBe(1);
    expect((await body(await send('GET', g(made.id, '/posts'), owner.cookie))).items).toEqual([]);

    await app.dataSource.query(`DELETE FROM "user" WHERE id = $1`, [owner.id]);
    const left = await app.dataSource.query(`SELECT count(*)::int AS n FROM paper_group WHERE id = $1`, [made.id]);
    expect(left[0].n).toBe(0);
  });
});

describe('the trail of who gained and lost access', () => {
  it('records the group being made, joined, left, a member removed, a role changed and the group deleted, with no names', async () => {
    const { owner, mod, member, id } = await crowd();
    expect((await send('POST', g(id, '/leave'), member.cookie)).status).toBe(204);
    expect((await send('DELETE', g(id), owner.cookie)).status).toBe(204);

    const actions = async (who: Reader) =>
      (await body(await send('GET', '/paper-library/activity', who.cookie))).items.map((i: any) => i.action).sort();
    expect(await actions(owner)).toEqual(['group.create', 'group.delete', 'group.role_change']);
    expect(await actions(member)).toEqual(['group.join', 'group.leave']);
    expect(await actions(mod)).toEqual(['group.join']);
    const details = JSON.stringify((await body(await send('GET', '/paper-library/activity', owner.cookie))).items);
    expect(details).not.toContain(`Olga ${run}`);
    expect(details).not.toContain(member.slug);
  });
});
