import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { PapersController } from '../src/papers/papers.controller';
import { PapersCatalogService } from '../src/papers/papers-catalog.service';
import { PapersFullText, isPublicAddress } from '../src/papers/papers-full-text.service';
import { PaperIds } from '../src/papers/paper-public-id';
import { PapersSearch } from '../src/papers/papers-search';
import { usePapers } from './papers-fixtures';

// The full text of a public paper is the PDF at its `paperUrl`, fetched by the API and read in place by the page.
// Pure: the real controller, catalog and service on an in-process Fastify app, with the network and the DNS stubbed.

const dns = vi.hoisted(() => ({
  lookup: vi.fn(async (host: string) => [{ address: host.startsWith('internal') ? '10.0.0.1' : '93.184.216.34', family: 4 }]),
}));
vi.mock('node:dns/promises', () => ({ lookup: dns.lookup, default: { lookup: dns.lookup } }));

const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\ntrailer\n<< /Root 1 0 R >>\nstartxref\n9\n%%EOF\n',
);
const SHA = createHash('sha256').update(PDF).digest('hex');
const WITH_SCRIPT = Buffer.from(PDF.toString('latin1').replace('/Type /Catalog', '/Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >>'), 'latin1');

const HOST = 'https://papers.example.org';
const answers = new Map<string, () => Response>();
const pdfResponse = () => new Response(PDF, { status: 200, headers: { 'content-type': 'application/pdf' } });
const fetchMock = vi.fn(async (input: URL | string) => {
  const make = answers.get(String(input));
  if (!make) return new Response('not found', { status: 404 });
  return make();
});
vi.stubGlobal('fetch', fetchMock);

describe('isPublicAddress', () => {
  it('accepts hosts on the public internet', () => {
    for (const ok of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111']) expect(isPublicAddress(ok), ok).toBe(true);
  });

  it('refuses loopback, private, link-local, shared, multicast and reserved addresses', () => {
    for (const bad of [
      '0.0.0.0', '127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
      '100.64.0.1', '198.18.0.1', '224.0.0.1', '::', '::1', 'fd00::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', 'not-an-address',
    ]) {
      expect(isPublicAddress(bad), bad).toBe(false);
    }
  });
});

describe('public paper full text (pure, no API)', () => {
  let app: NestFastifyApplication;
  let dropFiles: () => void;

  beforeAll(async () => {
    dropFiles = usePapers([
      { slug: 'open', title: 'Open', paperUrl: `${HOST}/open.pdf` },
      { slug: 'link-less', title: 'Link Less' },
      { slug: 'broken', title: 'Broken', paperUrl: `${HOST}/broken.pdf` },
      { slug: 'html-page', title: 'Html Page', paperUrl: `${HOST}/viewer` },
      { slug: 'scripted', title: 'Scripted', paperUrl: `${HOST}/scripted.pdf` },
      { slug: 'internal', title: 'Internal', paperUrl: 'https://internal.example.org/a.pdf' },
      { slug: 'plain-http', title: 'Plain Http', paperUrl: 'http://papers.example.org/a.pdf' },
      { slug: 'huge', title: 'Huge', paperUrl: `${HOST}/huge.pdf` },
      { slug: 'moved', title: 'Moved', paperUrl: `${HOST}/moved.pdf` },
      { slug: 'moved-inside', title: 'Moved Inside', paperUrl: `${HOST}/moved-inside.pdf` },
    ]);
    const catalog = new PapersCatalogService({} as never);
    @Module({
      controllers: [PapersController],
      providers: [
        { provide: PapersCatalogService, useValue: catalog },
        { provide: PapersFullText, useValue: new PapersFullText(catalog) },
        { provide: PaperIds, useValue: { resolve: (id: string) => id } },
        { provide: PapersSearch, useValue: {} },
      ],
    })
    class TestModule {}
    app = await NestFactory.create<NestFastifyApplication>(TestModule, new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    answers.set(`${HOST}/open.pdf`, pdfResponse);
    answers.set(`${HOST}/broken.pdf`, () => new Response('forbidden', { status: 403 }));
    answers.set(`${HOST}/viewer`, () => new Response('<html>a viewer</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    answers.set(`${HOST}/scripted.pdf`, () => new Response(WITH_SCRIPT, { status: 200 }));
    answers.set('http://papers.example.org/a.pdf', pdfResponse);
    answers.set('https://internal.example.org/a.pdf', pdfResponse);
    answers.set(`${HOST}/huge.pdf`, () => new Response(PDF, { status: 200, headers: { 'content-length': String(16 * 1024 * 1024) } }));
    answers.set(`${HOST}/moved.pdf`, () => new Response(null, { status: 302, headers: { location: 'https://papers.example.org/open.pdf' } }));
    answers.set(`${HOST}/moved-inside.pdf`, () => new Response(null, { status: 302, headers: { location: 'https://internal.example.org/a.pdf' } }));
  });

  beforeEach(() => fetchMock.mockClear());

  afterAll(async () => {
    vi.unstubAllGlobals();
    await app?.close();
    dropFiles?.();
  });

  const get = (slug: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'GET', url: `/papers/${slug}/full-text`, headers });

  it('serves the bytes of the PDF, as an attachment under a sandbox policy', async () => {
    const res = await get('open');
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(PDF)).toBe(true);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-length']).toBe(String(PDF.length));
    expect(res.headers['content-disposition']).toBe('attachment; filename="paper.pdf"');
    expect(res.headers['etag']).toBe(`"${SHA}"`);
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
  });

  it('answers 304 when the reader already has this file, and does not fetch the PDF again', async () => {
    const res = await get('open', { 'if-none-match': `"${SHA}"` });
    expect(res.statusCode).toBe(304);
    expect(res.rawPayload.length).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is a 404 for a paper with no PDF address and for one that does not exist', async () => {
    expect((await get('link-less')).statusCode).toBe(404);
    expect((await get('no-such-paper')).statusCode).toBe(404);
  });

  it('is a 502 "preview_unavailable" for a link that is broken, and does not hammer it', async () => {
    const first = await get('broken');
    expect(first.statusCode).toBe(502);
    expect(first.json().code).toBe('preview_unavailable');
    expect((await get('broken')).statusCode).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses what is not a PDF, or a PDF that runs code, even when the host answers 200', async () => {
    expect((await get('html-page')).statusCode).toBe(502);
    expect((await get('scripted')).statusCode).toBe(502);
  });

  it('never sends a request to a plain http address, to a host that resolves to a private address, or to a huge file', async () => {
    expect((await get('plain-http')).statusCode).toBe(502);
    expect((await get('internal')).statusCode).toBe(502);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain('http://papers.example.org/a.pdf');
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain('https://internal.example.org/a.pdf');
    expect((await get('huge')).statusCode).toBe(502);
  });

  it('follows a redirect by hand and checks the place it leads to like the first address', async () => {
    const moved = await get('moved');
    expect(moved.statusCode).toBe(200);
    expect(moved.rawPayload.equals(PDF)).toBe(true);

    expect((await get('moved-inside')).statusCode).toBe(502);
  });
});
