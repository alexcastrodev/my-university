import { describe, it, expect } from 'vitest';
import { get, post, json } from './helpers';

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
});

describe('GET /auth/me', () => {
  it('returns the user for a valid x-user-id', async () => {
    const { id } = await json<any>(await post('/auth/login', { displayName: `me-${Date.now()}` }));
    const res = await get('/auth/me', { 'x-user-id': String(id) });
    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(body.id).toBe(id);
  });

  it('returns 401 when x-user-id header is missing', async () => {
    const res = await get('/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 404 when user id does not exist', async () => {
    const res = await get('/auth/me', { 'x-user-id': '999999' });
    expect(res.status).toBe(404);
  });
});
