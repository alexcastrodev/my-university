import { Injectable, Logger } from '@nestjs/common';
import { parseBooks, type PublicBook } from './parse-books';

const DEFAULT_BASE = 'https://raw.githubusercontent.com/alexcastrodev/my-university/main/public/books';
const TIMEOUT_MS = 5_000;
const MAX_BYTES = 64 * 1024;
/** How long a file that was read is kept, and how long a missing or failed one is not asked for again. */
const KEEP_MS = 10 * 60 * 1000;
const KEEP_MISSING_MS = 2 * 60 * 1000;
const MAX_ENTRIES = 1000;
const USER_AGENT = 'kurz-university-books/1.0 (+https://university.kurz.fyi)';
/** What a GitHub login can be: it goes into the address, so nothing else (no slash, dot or query) gets through. */
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** Where the files are. `BOOKS_BASE_URL` points a test or a local run at its own server. */
const baseUrl = () => (process.env.BOOKS_BASE_URL ?? DEFAULT_BASE).replace(/\/+$/, '');

async function readCapped(body: ReadableStream<Uint8Array>): Promise<string> {
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
  return Buffer.concat(chunks).toString('utf-8');
}

/** The file's text, or null when there is no such file. Redirects are refused: the address is fixed. */
async function download(url: string): Promise<string | null> {
  const res = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: 'text/plain', 'User-Agent': USER_AGENT },
  });
  if (res.status === 404) {
    await res.body?.cancel();
    return null;
  }
  if (!res.ok || !res.body) throw new Error(`the host answered ${res.status}`);
  if (Number(res.headers.get('content-length')) > MAX_BYTES) {
    await res.body.cancel();
    throw new Error('too large');
  }
  return readCapped(res.body);
}

/**
 * The books a person listed in `public/books/<github login>.md` of the repository, read from there when the
 * profile asks (so a merged pull request shows up without a deploy). The address is the fixed repository folder
 * plus the lowercase login, checked against what a login can be; the answer is capped in time and size, and
 * anything that goes wrong is an empty shelf, never an error. The file belongs to whoever has that GitHub login.
 *
 * ponytail: per-process cache; many different logins mean many requests to the host. Upgrade: list the folder
 * once (GitHub API, cached) and only ask for the logins that have a file.
 */
@Injectable()
export class BooksService {
  private readonly logger = new Logger(BooksService.name);
  private readonly cache = new Map<string, { until: number; books: PublicBook[] }>();
  private readonly pending = new Map<string, Promise<PublicBook[]>>();

  async booksOf(login: string): Promise<PublicBook[]> {
    if (!LOGIN.test(login)) return [];
    const name = login.toLowerCase();
    const kept = this.cache.get(name);
    if (kept && kept.until > Date.now()) return kept.books;
    let job = this.pending.get(name);
    if (!job) {
      job = this.load(name).finally(() => this.pending.delete(name));
      this.pending.set(name, job);
    }
    return job;
  }

  private async load(name: string): Promise<PublicBook[]> {
    let books: PublicBook[] = [];
    let keepFor = KEEP_MISSING_MS;
    try {
      const text = await download(`${baseUrl()}/${name}.md`);
      if (text !== null) {
        books = parseBooks(text);
        keepFor = KEEP_MS;
      }
    } catch (error) {
      this.logger.warn(`could not read the books of ${name}: ${(error as Error).message}`);
    }
    this.cache.delete(name);
    if (this.cache.size >= MAX_ENTRIES) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(name, { until: Date.now() + keepFor, books });
    return books;
  }
}
