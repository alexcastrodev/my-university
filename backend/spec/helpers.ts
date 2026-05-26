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
