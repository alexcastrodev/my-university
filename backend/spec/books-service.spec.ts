import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { BooksService } from '../src/books/books.service';
import { ProfileController } from '../src/xp/xp.controller';

// Pure: the real service and controller with `fetch` stubbed, so no network and no database.

const BASE = 'https://files.example.org/public/books';
const TABLE = '| Livro | Páginas | Capa |\n| --- | --- | --- |\n| [Clean Code](https://example.com/cc) | 464 | https://example.com/cc.jpg |\n';
const BOOK = { title: 'Clean Code', url: 'https://example.com/cc', pages: 464, cover: 'https://example.com/cc.jpg' };

const files = new Map<string, () => Response>();
const fetchMock = vi.fn(async (input: string | URL, _init?: RequestInit) => {
  const make = files.get(String(input));
  return make ? make() : new Response('not found', { status: 404 });
});
vi.stubGlobal('fetch', fetchMock);

const text = (body: string, init: ResponseInit = {}) => () => new Response(body, { status: 200, ...init });

beforeEach(() => {
  process.env.BOOKS_BASE_URL = BASE;
  files.clear();
  fetchMock.mockClear();
});
afterEach(() => {
  delete process.env.BOOKS_BASE_URL;
  vi.useRealTimers();
});

describe('BooksService', () => {
  it('reads the books from the file named after the login', async () => {
    files.set(`${BASE}/ada.md`, text(TABLE));
    expect(await new BooksService().booksOf('ada')).toEqual([BOOK]);
  });

  it('asks for the lowercase file, whatever case the login has', async () => {
    files.set(`${BASE}/alexcastrodev.md`, text(TABLE));
    expect(await new BooksService().booksOf('AlexCastroDev')).toEqual([BOOK]);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/alexcastrodev.md`);
  });

  it('uses the repository on GitHub when nothing says otherwise', async () => {
    delete process.env.BOOKS_BASE_URL;
    await new BooksService().booksOf('ada');
    expect(fetchMock.mock.calls[0][0]).toBe('https://raw.githubusercontent.com/alexcastrodev/my-university/main/public/books/ada.md');
  });

  it('gives an empty shelf when there is no file', async () => {
    expect(await new BooksService().booksOf('nobody')).toEqual([]);
  });

  it('gives an empty shelf when the host fails, the file is too large, or the host redirects', async () => {
    files.set(`${BASE}/broken.md`, () => new Response('oops', { status: 500 }));
    files.set(`${BASE}/huge.md`, text('x'.repeat(70 * 1024)));
    files.set(`${BASE}/declared.md`, text('x', { headers: { 'content-length': String(70 * 1024) } }));
    fetchMock.mockImplementationOnce(async () => { throw new TypeError('redirect mode is set to error'); });
    const service = new BooksService();
    expect(await service.booksOf('moved')).toEqual([]);
    for (const login of ['broken', 'huge', 'declared']) expect(await service.booksOf(login), login).toEqual([]);
  });

  it('refuses redirects and sets a time limit on the request', async () => {
    await new BooksService().booksOf('ada');
    const init = fetchMock.mock.calls[0][1];
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('makes no request for something that cannot be a GitHub login', async () => {
    const service = new BooksService();
    for (const bad of ['', '../etc/passwd', 'a/b', 'a.b', 'a?b=1', '-leading', 'a b', 'a'.repeat(40), 'x\n', '%2e%2e']) {
      expect(await service.booksOf(bad), bad).toEqual([]);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks once for a login, even for two requests at the same time, then keeps the answer', async () => {
    files.set(`${BASE}/ada.md`, text(TABLE));
    const service = new BooksService();
    const [a, b] = await Promise.all([service.booksOf('ada'), service.booksOf('ada')]);
    expect(a).toEqual([BOOK]);
    expect(b).toEqual([BOOK]);
    await service.booksOf('ada');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks again after ten minutes for a file it found, and after two for one it did not', async () => {
    vi.useFakeTimers();
    files.set(`${BASE}/ada.md`, text(TABLE));
    const service = new BooksService();
    await service.booksOf('ada');
    await service.booksOf('nobody');
    vi.advanceTimersByTime(3 * 60 * 1000);
    await service.booksOf('ada');
    await service.booksOf('nobody');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(8 * 60 * 1000);
    await service.booksOf('ada');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe('GET /profile/:key/books', () => {
  const reply = { header: vi.fn() } as never;

  it('answers with the books of the login behind a public profile, and nothing else', async () => {
    const xp = { getPublicGithubLogin: vi.fn(async () => 'ada') };
    const books = { booksOf: vi.fn(async () => [BOOK]) };
    const body = await new ProfileController(xp as never, books as never).getBooks('some-key', reply);
    expect(body).toEqual({ books: [BOOK] });
    expect(JSON.stringify(body)).not.toContain('ada');
    expect(books.booksOf).toHaveBeenCalledWith('ada');
  });

  it('is a 404 for a profile that is private, unknown or malformed, and reads no file', async () => {
    const xp = { getPublicGithubLogin: vi.fn(async () => null) };
    const books = { booksOf: vi.fn() };
    await expect(new ProfileController(xp as never, books as never).getBooks('nope', reply)).rejects.toBeInstanceOf(NotFoundException);
    expect(books.booksOf).not.toHaveBeenCalled();
  });

  it('is never stored by a cache, so going private takes effect on the next request', async () => {
    const header = vi.fn();
    const xp = { getPublicGithubLogin: vi.fn(async () => 'ada') };
    await new ProfileController(xp as never, { booksOf: async () => [] } as never).getBooks('k', { header } as never);
    expect(header).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
});
