import { describe, expect, it } from 'vitest';
import { get, json, login, put } from './helpers';

// Needs the running API (like profile.spec.ts). Test users have no file in the repository, so what is under
// test is the route: who can reach it, what it answers, and that the GitHub login never shows.

interface Me { publicProfileId: string; profileSlug: string | null; githubLogin: string }

async function user(name: string) {
  const { cookie } = await login(`${name}-${Date.now()}`);
  const me = await json<Me>(await get('/auth/me', { Cookie: cookie }));
  return { cookie, ...me };
}

describe('GET /profile/:key/books', () => {
  it('needs no session, is never cached, and has an empty shelf for someone with no file', async () => {
    const u = await user('pb-empty');
    const res = await get(`/profile/${u.publicProfileId}/books`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await json(res)).toEqual({ books: [] });
  });

  it('is reached by the vanity link as well as by the id', async () => {
    const u = await user('pb-slug');
    const slug = `pb-${Date.now().toString(36)}`;
    expect((await put('/auth/profile-slug', { slug }, { Cookie: u.cookie })).status).toBe(200);
    expect((await get(`/profile/${slug}/books`)).status).toBe(200);
    expect((await get(`/profile/${slug.toUpperCase()}/books`)).status).toBe(200);
  });

  it('never shows the GitHub login that names the file, and the login is not a way in', async () => {
    const u = await user('pb-login');
    const raw = JSON.stringify(await json(await get(`/profile/${u.publicProfileId}/books`)));
    expect(raw).not.toContain(u.githubLogin);
    expect(raw).not.toContain('githubLogin');
    expect((await get(`/profile/${u.githubLogin}/books`)).status).toBe(404);
  });

  it('is a 404 for an unknown or malformed key', async () => {
    for (const key of ['01a14000-0000-7000-8000-000000000bad', 'nobody-has-this-slug', '!!', 'a']) {
      expect((await get(`/profile/${key}/books`)).status, key).toBe(404);
    }
  });

  it('is a 404 as soon as the profile goes private, and back when it is public again', async () => {
    const u = await user('pb-private');
    await put('/auth/settings', { profilePublic: false }, { Cookie: u.cookie });
    expect((await get(`/profile/${u.publicProfileId}/books`)).status).toBe(404);
    await put('/auth/settings', { profilePublic: true }, { Cookie: u.cookie });
    expect((await get(`/profile/${u.publicProfileId}/books`)).status).toBe(200);
  });
});
