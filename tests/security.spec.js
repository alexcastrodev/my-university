import { test, expect } from '@playwright/test';
import { BASE_URL } from './BaseTest.js';
import { textPdf } from './pdf-fixtures.js';

// What the deployed stack (nginx in front of the app and the API) sends and accepts, checked on the running
// environment rather than on the config files: the security headers, the policy that keeps scripts nonce-only,
// the headers a private PDF is served with, and that a real-sized PDF gets through nginx for a public paper.
// No page is opened: every check is a request and an assertion on the response.
const PAPER = 'foundationdb-unbundled-transactional-kv-store';

async function signIn(request) {
  const res = await request.post(`${BASE_URL}/api/auth/_test/login`, { data: { displayName: `Security ${Math.random().toString(36).slice(2, 8)}` } });
  expect(res.ok(), 'POST /api/auth/_test/login (needs ENABLE_DEV_AUTH=1)').toBeTruthy();
}

/** One header, joined when the response carries it more than once (nginx and the API both set a policy). */
const header = (res, name) => res.headersArray().filter((h) => h.name.toLowerCase() === name).map((h) => h.value).join(', ');

test.describe('security headers', () => {
  for (const [what, path] of [
    ['a server-rendered page', '/papers'],
    ['a client-rendered page', '/library'],
    ['the API', '/api/papers'],
    ['a PDF engine file', '/pdfjs/pdf.worker.min.mjs'],
  ]) {
    test(`are sent with ${what}`, async ({ request }) => {
      const res = await request.get(`${BASE_URL}${path}`);
      expect(res.ok(), path).toBeTruthy();
      expect(header(res, 'x-content-type-options')).toBe('nosniff');
      expect(header(res, 'x-frame-options')).toBe('SAMEORIGIN');
      expect(header(res, 'referrer-policy')).toBe('strict-origin-when-cross-origin');
      expect(header(res, 'permissions-policy')).toContain('camera=()');
      const csp = header(res, 'content-security-policy');
      for (const directive of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'"]) {
        expect(csp, `${path}: ${directive}`).toContain(directive);
      }
    });
  }

  test('keep scripts to the ones nginx stamped with this response\'s nonce', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/papers`);
    const csp = header(res, 'content-security-policy');
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(scriptSrc).not.toContain('unsafe-eval');
    const nonce = /'nonce-([^']+)'/.exec(scriptSrc)?.[1];
    expect(nonce, 'script-src carries a nonce').toBeTruthy();
    const html = await res.text();
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)].map((m) => m[0]);
    expect(inline.length).toBeGreaterThan(0);
    for (const tag of inline) expect(tag, 'an inline script without this response\'s nonce').toContain(`nonce="${nonce}"`);
  });

  test('use a new nonce for every response', async ({ request }) => {
    const nonce = async () => /'nonce-([^']+)'/.exec(header(await request.get(`${BASE_URL}/papers`), 'content-security-policy'))?.[1];
    expect(await nonce()).not.toBe(await nonce());
  });
});

test.describe('a private PDF', () => {
  test.afterEach(async ({ request }) => {
    await request.delete(`${BASE_URL}/api/papers/${PAPER}/attachment`);
    await request.delete(`${BASE_URL}/api/paper-library/${PAPER}`);
  });

  async function upload(request, bytes) {
    return request.put(`${BASE_URL}/api/papers/${PAPER}/attachment`, {
      data: bytes,
      headers: { 'Content-Type': 'application/pdf', 'X-Filename': 'thesis.pdf' },
    });
  }

  test('is served as a download that nothing on this origin renders, runs or caches, and only to its owner', async ({ request, browser }) => {
    await signIn(request);
    expect((await request.post(`${BASE_URL}/api/paper-library`, { data: { paperId: PAPER } })).ok()).toBeTruthy();
    expect((await upload(request, textPdf(['one page']))).status()).toBe(201);

    const res = await request.get(`${BASE_URL}/api/papers/${PAPER}/attachment/file`);
    expect(res.status()).toBe(200);
    expect(header(res, 'content-type')).toBe('application/pdf');
    expect(header(res, 'content-disposition')).toMatch(/^attachment;/);
    // Both the API and nginx send it, which is harmless: browsers read the first value.
    expect(header(res, 'x-content-type-options')).toContain('nosniff');
    expect(header(res, 'cache-control')).toBe('private, no-store');
    expect(header(res, 'content-security-policy')).toContain('sandbox');

    // Without the owner's session the same URL answers nothing: there is no link that keeps working.
    const stranger = await browser.newContext();
    expect((await stranger.request.get(`${BASE_URL}/api/papers/${PAPER}/attachment/file`)).status()).toBe(401);
    await stranger.close();
  });

  test('gets through nginx at a realistic size, and a file with a script in it is refused and never served', async ({ request }) => {
    await signIn(request);
    expect((await request.post(`${BASE_URL}/api/paper-library`, { data: { paperId: PAPER } })).ok()).toBeTruthy();

    // 3 MB: above nginx's default body limit of 1 MB, far below the 25 MB the API accepts.
    const big = await upload(request, textPdf(['a long paper'], { padding: 3 * 1024 * 1024 }));
    expect(big.status(), await big.text()).toBe(201);

    const scripted = textPdf(['trick']).toString('latin1').replace('/Type /Catalog', '/Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >>');
    const refused = await upload(request, Buffer.from(scripted, 'latin1'));
    expect(refused.status()).toBe(422);
    expect((await refused.json()).code).toBe('active_content');
    // The earlier, clean file is still the one served: a refusal replaces nothing.
    const record = await (await request.get(`${BASE_URL}/api/papers/${PAPER}/attachment`)).json();
    expect(record.current).toBe(1);
    expect((await request.get(`${BASE_URL}/api/papers/${PAPER}/attachment/file`)).status()).toBe(200);
  });
});
