import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadStorageConfig } from '../src/storage/storage.config';
import { json } from './helpers';
import { startStorageApp, StorageApp } from './storage-app';

// Talks HTTP to a Nest server (spec/storage-app.ts) backed by the real S3-compatible server from
// docker-compose, configured through the same S3_* variables the API reads. Each test sends a
// request and asserts on the response; presigned URLs are then requested from SeaweedFS itself.
const s3 = loadStorageConfig();
const pdf = '%PDF-1.7 spec payload';

let app: StorageApp;
const created: string[] = [];

const send = (path: string, init?: RequestInit, base = app.url) =>
  fetch(`${base}/storage${path}`, init);
const q = (params: Record<string, string | number>) =>
  new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  ).toString();

async function upload(content = pdf, contentType = 'application/pdf') {
  const res = await send('/objects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, contentType }),
  });
  const { key } = await json<{ key: string }>(res);
  created.push(key);
  return { res, key };
}
const presignGet = async (key: string, extra: Record<string, number> = {}) =>
  (
    await json<{ url: string }>(
      await send(`/presign-get?${q({ key, ...extra })}`),
    )
  ).url;

beforeAll(async () => {
  app = await startStorageApp();
});
afterEach(async () => {
  await Promise.all(
    created
      .splice(0)
      .map((key) => send(`/objects?${q({ key })}`, { method: 'DELETE' })),
  );
});
afterAll(() => app.close());

describe('POST /storage/objects', () => {
  it('stores the object and answers 201 with an opaque key', async () => {
    const { res, key } = await upload();
    expect(res.status).toBe(201);
    expect(key).toMatch(/^spec\/[0-9a-f-]{36}$/);
  });

  it('gives a different key to every upload, whatever the content', async () => {
    const a = await upload();
    const b = await upload();
    expect(a.key).not.toBe(b.key);
  });
});

describe('GET /storage/objects/meta', () => {
  it('answers 200 with the size and content type of a stored object', async () => {
    const { key } = await upload();
    const res = await send(`/objects/meta?${q({ key })}`);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({
      size: pdf.length,
      contentType: 'application/pdf',
    });
  });

  it('answers 404 for a key that was never stored', async () => {
    const res = await send(`/objects/meta?${q({ key: 'spec/missing' })}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /storage/presign-get', () => {
  it('returns a URL that downloads the exact bytes', async () => {
    const { key } = await upload();
    const res = await fetch(await presignGet(key));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(pdf);
  });

  it('answers 404 on the URL once the object was deleted', async () => {
    const { key } = await upload();
    const url = await presignGet(key);
    await send(`/objects?${q({ key })}`, { method: 'DELETE' });
    expect((await fetch(url)).status).toBe(404);
  });

  it('stops working after the expiry', async () => {
    const { key } = await upload();
    const url = await presignGet(key, { expiresIn: 1 });
    expect((await fetch(url)).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect((await fetch(url)).status).toBe(403);
  });

  it.each([0, 3601, 1.5])(
    'answers 400 for an expiry of %s seconds',
    async (expiresIn: number) => {
      const res = await send(
        `/presign-get?${q({ key: 'spec/any', expiresIn })}`,
      );
      expect(res.status).toBe(400);
    },
  );

  it('rejects a URL whose signature was tampered with', async () => {
    const { key } = await upload();
    const url = new URL(await presignGet(key));
    url.searchParams.set('X-Amz-Signature', '0'.repeat(64));
    expect((await fetch(url)).status).toBe(403);
  });
});

describe('objects are private', () => {
  it('refuses to serve a stored object without a signature', async () => {
    const { key } = await upload();
    const res = await fetch(`${s3.endpoint}/${s3.bucket}/${key}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /storage/presign-put', () => {
  const presignPut = async (contentType: string) =>
    json<{ key: string; url: string }>(
      await send(`/presign-put?${q({ contentType })}`),
    );

  it('returns a URL that accepts the upload, visible afterwards through the metadata route', async () => {
    const { key, url } = await presignPut('application/pdf');
    created.push(key);

    const put = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      body: pdf,
    });
    expect(put.status).toBe(200);

    const meta = await send(`/objects/meta?${q({ key })}`);
    expect(meta.status).toBe(200);
    expect(await json(meta)).toMatchObject({ size: pdf.length });
  });

  it('refuses an upload sent with a different Content-Type than was signed', async () => {
    const { key, url } = await presignPut('application/pdf');
    created.push(key);

    const put = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/html' },
      body: pdf,
    });
    expect(put.status).toBe(403);
    expect((await send(`/objects/meta?${q({ key })}`)).status).toBe(404);
  });
});

describe('DELETE /storage/objects', () => {
  it('answers 204, after which the metadata route answers 404', async () => {
    const { key } = await upload();
    const del = await send(`/objects?${q({ key })}`, { method: 'DELETE' });
    expect(del.status).toBe(204);
    expect((await send(`/objects/meta?${q({ key })}`)).status).toBe(404);
  });

  it('answers 204 again for an object that is already gone', async () => {
    const res = await send(`/objects?${q({ key: 'spec/missing' })}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(204);
  });
});

describe('configuration failures', () => {
  const uploadTo = async (env: NodeJS.ProcessEnv) => {
    const broken = await startStorageApp({ ...process.env, ...env });
    try {
      return await send(
        '/objects',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: pdf,
            contentType: 'application/pdf',
          }),
        },
        broken.url,
      );
    } finally {
      await broken.close();
    }
  };

  it('answers 502 carrying the 403 from storage when the secret key is wrong', async () => {
    const res = await uploadTo({ S3_SECRET_KEY: 'not-the-secret' });
    expect(res.status).toBe(502);
    expect(await json(res)).toMatchObject({ upstreamStatus: 403 });
  });

  it('answers 502 carrying the 403 from storage when the access key is unknown', async () => {
    const res = await uploadTo({ S3_ACCESS_KEY: 'nobody' });
    expect(res.status).toBe(502);
    expect(await json(res)).toMatchObject({ upstreamStatus: 403 });
  });

  it('answers 502 with no upstream status when the endpoint is unreachable', async () => {
    const res = await uploadTo({ S3_ENDPOINT: 'http://127.0.0.1:1' });
    expect(res.status).toBe(502);
    expect(await json(res)).toMatchObject({ upstreamStatus: null });
  });

  it('signs presigned URLs for the public endpoint when one is configured', async () => {
    const other = await startStorageApp({
      ...process.env,
      S3_PUBLIC_ENDPOINT: 'https://files.example.test',
    });
    try {
      const res = await send('/presign-get?key=spec/abc', undefined, other.url);
      const { url } = await json<{ url: string }>(res);
      expect(new URL(url).origin).toBe('https://files.example.test');
    } finally {
      await other.close();
    }
  });
});
