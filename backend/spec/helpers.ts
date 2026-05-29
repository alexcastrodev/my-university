export const BASE = process.env.API_URL ?? 'http://localhost/api';

export async function get(path: string, headers: Record<string, string> = {}) {
  return fetch(`${BASE}${path}`, { headers });
}

export async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

export async function put(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

export async function json<T = unknown>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}

/** Signs up a fresh user and returns the id plus the session cookie to replay. */
export async function login(displayName: string): Promise<{ id: number; cookie: string }> {
  const res = await post('/auth/signup', { displayName });
  const setCookie = res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie') ?? '';
  const cookie = setCookie.split(';')[0];
  const { id } = (await res.json()) as { id: number };
  return { id, cookie };
}
