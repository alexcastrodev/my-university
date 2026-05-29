import { describe, it, expect } from 'vitest';
import { get, post, json, login } from './helpers';

describe('POST /auth/signup', () => {
  it('creates a new user and returns it', async () => {
    const res = await post('/auth/signup', { displayName: `spec-user-${Date.now()}` });
    expect(res.status).toBe(201);
    const body = await json<any>(res);
    expect(body).toMatchObject({ id: expect.any(Number), displayName: expect.any(String) });
  });

  it('rejects signing up a name that already exists (case-insensitive)', async () => {
    const name = `taken-${Date.now()}`;
    expect((await post('/auth/signup', { displayName: name })).status).toBe(201);
    expect((await post('/auth/signup', { displayName: name.toUpperCase() })).status).toBe(409);
  });

  it('returns 400 when displayName is empty', async () => {
    const res = await post('/auth/signup', { displayName: '   ' });
    expect(res.status).toBe(400);
  });

  it('sets a session cookie on success', async () => {
    const res = await post('/auth/signup', { displayName: `cookie-${Date.now()}` });
    const setCookie = res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('uid=');
    expect(setCookie.toLowerCase()).toContain('httponly');
  });
});

describe('POST /auth/login', () => {
  it('returns the existing user (case-insensitive) and a session cookie', async () => {
    const name = `login-${Date.now()}`;
    const created = await json<any>(await post('/auth/signup', { displayName: name }));
    const res = await post('/auth/login', { displayName: name.toUpperCase() });
    expect(res.status).toBe(201);
    expect((await json<any>(res)).id).toBe(created.id);
    const setCookie = res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('uid=');
  });

  it('returns 404 for a name that was never registered', async () => {
    const res = await post('/auth/login', { displayName: `ghost-${Date.now()}` });
    expect(res.status).toBe(404);
  });

  it('returns 400 when displayName is empty', async () => {
    const res = await post('/auth/login', { displayName: '   ' });
    expect(res.status).toBe(400);
  });
});

describe('GET /auth/me', () => {
  it('returns the user for a valid session cookie', async () => {
    const { id, cookie } = await login(`me-${Date.now()}`);
    const res = await get('/auth/me', { Cookie: cookie });
    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(body.id).toBe(id);
  });

  it('returns 401 when no session cookie is present', async () => {
    const res = await get('/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 for an invalid / forged session cookie', async () => {
    const res = await get('/auth/me', { Cookie: 'uid=999999' });
    expect(res.status).toBe(401);
  });
});
