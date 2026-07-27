import http from 'node:http';
import { describe, it, expect } from 'vitest';
import { BASE, get, json, login } from './helpers';

function rawGet(
  path: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    http
      .get(`${BASE}${path}`, (res) => {
        res.resume();
        resolve({ status: res.statusCode ?? 0, headers: res.headers });
      })
      .on('error', reject);
  });
}

describe('GET /auth/github', () => {
  it('redirects to GitHub with a state param and sets a signed state cookie', async () => {
    const res = await rawGet('/auth/github');
    expect(res.status).toBe(302);

    const location = res.headers.location ?? '';
    expect(location).toContain('https://github.com/login/oauth/authorize');
    expect(location).toContain('state=');

    const setCookie = Array.isArray(res.headers['set-cookie'])
      ? res.headers['set-cookie'][0]
      : '';
    expect(setCookie).toContain('gh_oauth_state=');
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
