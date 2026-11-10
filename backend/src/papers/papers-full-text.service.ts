import { BadGatewayException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { scanPdf } from '../paper-attachments/pdf-scan';
import { PapersCatalogService } from './papers-catalog.service';

/** The PDF behind a public paper's `paperUrl`, checked, and what the route needs to serve it. */
export interface FullTextFile {
  body: Buffer;
  sha256: string;
}

const TIMEOUT_MS = 12_000;
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_REDIRECTS = 3;
/** How long a PDF that was fetched is kept, and how long a link that failed is not tried again. */
const KEEP_MS = 60 * 60 * 1000;
const KEEP_FAILURE_MS = 5 * 60 * 1000;
const CACHE_BYTES = 64 * 1024 * 1024;
const USER_AGENT = 'kurz-university-fulltext/1.0 (+https://university.kurz.fyi)';

/** True for an address on the public internet: not loopback, private, link-local, shared (CGNAT), multicast or reserved. */
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const v6 = address.toLowerCase();
  // An IPv4 address wearing an IPv6 coat is refused whole: fail closed.
  return isIP(v6) === 6 && !(v6 === '::' || v6 === '::1' || v6.startsWith('::ffff:') || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith('ff'));
}

/** A plain https address of a host on the public internet; anything else is refused before a byte is sent. */
async function assertPublicHttps(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('not a plain https address');
  if (isIP(url.hostname.replace(/^\[|\]$/g, ''))) throw new Error('an address instead of a host name');
  const found = await lookup(url.hostname, { all: true });
  if (!found.length || !found.every((a) => isPublicAddress(a.address))) throw new Error('not a public host');
  return url;
}

async function readCapped(body: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new Error('too large');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** Follows at most a few redirects by hand, so every hop is checked like the first address. */
async function download(start: string): Promise<Buffer> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const checked = await assertPublicHttps(url);
    const res = await fetch(checked, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'application/pdf', 'User-Agent': USER_AGENT },
    });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      await res.body?.cancel();
      if (!next) throw new Error('a redirect without a destination');
      url = new URL(next, checked).href;
      continue;
    }
    if (!res.ok || !res.body) throw new Error(`the host answered ${res.status}`);
    if (Number(res.headers.get('content-length')) > MAX_BYTES) throw new Error('too large');
    return readCapped(res.body);
  }
  throw new Error('too many redirects');
}

/**
 * The full text of a public paper: the PDF at the `paperUrl` its entry in `papers.json` gives, fetched by the API so
 * the page can read it in place (a browser could not: the page's policy allows no foreign connection, and many
 * publishers refuse one). The address comes from the reviewed file, never from a request; it is still held to
 * https and a public host, redirects are followed by hand and checked, the size and the time are capped, and the
 * bytes go through the same static scan as an upload before anyone sees them. A link that fails is a 502 the page
 * shows as "preview not available", so changing the link in `papers.json` (to a self-hosted copy, say) is the fix.
 *
 * ponytail: per-process cache; share it only if several API replicas make the repeat fetches matter.
 */
@Injectable()
export class PapersFullText {
  private readonly logger = new Logger(PapersFullText.name);
  private readonly cache = new Map<string, { until: number; file: FullTextFile | null }>();
  private readonly pending = new Map<string, Promise<FullTextFile | null>>();

  constructor(@Inject(PapersCatalogService) private readonly catalog: PapersCatalogService) {}

  async get(slug: string): Promise<FullTextFile> {
    const url = this.catalog.paperUrlOf(slug);
    if (!url) throw new NotFoundException();
    const kept = this.cache.get(url);
    let file: FullTextFile | null;
    if (kept && kept.until > Date.now()) {
      file = kept.file;
    } else {
      let job = this.pending.get(url);
      if (!job) {
        job = this.fetchOnce(url).finally(() => this.pending.delete(url));
        this.pending.set(url, job);
      }
      file = await job;
    }
    if (!file) {
      throw new BadGatewayException({ code: 'preview_unavailable', message: 'The PDF of this paper cannot be shown.' });
    }
    return file;
  }

  private async fetchOnce(url: string): Promise<FullTextFile | null> {
    let file: FullTextFile | null = null;
    try {
      const body = await download(url);
      const verdict = scanPdf(body);
      if (!verdict.ok) throw new Error(`refused by the PDF scan (${verdict.code})`);
      file = { body, sha256: createHash('sha256').update(body).digest('hex') };
    } catch (err) {
      this.logger.warn(`The PDF at ${url} cannot be shown: ${(err as Error).message}`);
    }
    this.keep(url, file);
    return file;
  }

  private keep(url: string, file: FullTextFile | null): void {
    this.cache.delete(url);
    this.cache.set(url, { until: Date.now() + (file ? KEEP_MS : KEEP_FAILURE_MS), file });
    let bytes = 0;
    for (const entry of this.cache.values()) bytes += entry.file?.body.length ?? 0;
    // Oldest first, until the cache fits.
    for (const [key, entry] of this.cache) {
      if (bytes <= CACHE_BYTES) break;
      bytes -= entry.file?.body.length ?? 0;
      this.cache.delete(key);
    }
  }
}
