import { describe, it, expect } from 'vitest';
import { get, post, json, login } from './helpers';

describe('POST /auth/login', () => {
  it('creates a new user and returns it', async () => {
    const res = await post('/auth/login', { displayName: `spec-user-${Date.now()}` });
    expect(res.status).toBe(201);
    const body = await json<any>(res);
    expect(body).toMatchObject({ id: expect.any(Number), displayName: expect.any(String) });
  });

  it('returns the same user on repeated login with the same name (case-insensitive)', async () => {
    const name = `repeated-${Date.now()}`;
    const first = await json<any>(await post('/auth/login', { displayName: name }));
    const second = await json<any>(await post('/auth/login', { displayName: name.toUpperCase() }));
    expect(first.id).toBe(second.id);
  });

  it('returns 400 when displayName is empty', async () => {
    const res = await post('/auth/login', { displayName: '   ' });
    expect(res.status).toBe(400);
  });

  it('sets a session cookie on success', async () => {
    const res = await post('/auth/login', { displayName: `cookie-${Date.now()}` });
    const setCookie = res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('uid=');
    expect(setCookie.toLowerCase()).toContain('httponly');
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
