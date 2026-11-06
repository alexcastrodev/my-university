import { describe, expect, it } from 'vitest';
import { MAX_BOOKS, parseBooksTable } from '../src/books/parse-books';

// Pure: the table a person writes in public/books/<github>.md, turned into the books the profile shows.

const COVER = 'https://covers.openlibrary.org/b/isbn/9781449373320-L.jpg';
const row = (title: string, pages: string | number, cover = '') => `| ${title} | ${pages} | ${cover} |`;
const link = (title: string, url = 'https://example.com/book') => `[${title}](${url})`;

describe('parseBooksTable', () => {
  it('reads the table of the documented format, header and separator included', () => {
    const text = [
      '| Livro | Páginas | Capa |',
      '| --- | --- | --- |',
      row(link('Designing Data-Intensive Applications', 'https://dataintensive.net/'), 616, COVER),
      row(link('Clean Code'), 464),
    ].join('\n');
    expect(parseBooksTable(text)).toEqual([
      { title: 'Designing Data-Intensive Applications', url: 'https://dataintensive.net/', pages: 616, cover: COVER },
      { title: 'Clean Code', url: 'https://example.com/book', pages: 464 },
    ]);
  });

  it('ignores text around the table and accepts Windows line endings', () => {
    const text = `# My books\r\n\r\nSome words.\r\n${row(link('A'), 100)}\r\n\r\nMore words.\r\n`;
    expect(parseBooksTable(text).map((b) => b.title)).toEqual(['A']);
  });

  it('returns nothing for text with no table', () => {
    expect(parseBooksTable('')).toEqual([]);
    expect(parseBooksTable('just text\n- a list\n')).toEqual([]);
  });

  it('skips a row that breaks a rule and keeps the others', () => {
    const text = [
      row(link('Good one'), 100),
      row(link('Plain http link', 'http://example.com/a'), 100),
      row(link('Bad cover', 'https://example.com/a'), 100, 'javascript:alert(1)'),
      row(link('Http cover'), 100, 'http://example.com/c.jpg'),
      row(link('Zero pages'), 0),
      row(link('Too many pages'), 5001),
      row(link('Word pages'), 'abc'),
      row(link('Negative pages'), '-5'),
      row(link('Fractional pages'), '10.5'),
      row('No link at all', 100),
      row('[Empty address]()', 100),
      row(link('Credentials', 'https://user:secret@example.com/a'), 100),
      row(link('Last good one'), 5000),
    ].join('\n');
    expect(parseBooksTable(text).map((b) => b.title)).toEqual(['Good one', 'Last good one']);
  });

  it('wants exactly three cells', () => {
    const text = [
      `| ${link('Two cells')} | 100 |`,
      `| ${link('Four cells')} | 100 | | extra |`,
      `${link('No pipes')} | 100 | `,
      row(link('Fine'), 100),
    ].join('\n');
    expect(parseBooksTable(text).map((b) => b.title)).toEqual(['Fine']);
  });

  it('refuses titles with brackets, empty titles and invisible characters', () => {
    const text = [
      row('[Nested [brackets]](https://example.com/a)', 100),
      row('[   ](https://example.com/a)', 100),
      row(link('Zero​width'), 100),
      row(link('Right‮to left'), 100),
      row(link('Tab\there'), 100),
      row(link('Café Olé'), 100),
    ].join('\n');
    expect(parseBooksTable(text).map((b) => b.title)).toEqual(['Café Olé']);
  });

  it('keeps the title as plain text, markup and all', () => {
    const [book] = parseBooksTable(row(link('<img src=x onerror=alert(1)>'), 100));
    expect(book.title).toBe('<img src=x onerror=alert(1)>');
  });

  it('returns a clean object with only the allowed fields, even for names like __proto__', () => {
    const [book] = parseBooksTable(row(link('__proto__'), 100));
    expect(Object.keys(book).sort()).toEqual(['pages', 'title', 'url']);
    expect(book.title).toBe('__proto__');
    expect(Object.getPrototypeOf(book)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).title).toBeUndefined();
  });

  it('keeps at most 200 books', () => {
    const text = Array.from({ length: 300 }, (_, i) => row(link(`Book ${i}`), 100)).join('\n');
    const books = parseBooksTable(text);
    expect(books).toHaveLength(MAX_BOOKS);
    expect(books[199].title).toBe('Book 199');
  });

  it('reads no more than 1000 lines', () => {
    const text = `${'\n'.repeat(1000)}${row(link('Too late'), 100)}`;
    expect(parseBooksTable(text)).toEqual([]);
  });

  it('drops a row with an address over 500 characters', () => {
    const long = `https://example.com/${'a'.repeat(500)}`;
    expect(parseBooksTable(row(link('Long link', long), 100))).toEqual([]);
    expect(parseBooksTable(row(link('Long cover'), 100, long))).toEqual([]);
  });

  it('stays fast on hostile lines that would hurt a careless pattern', () => {
    const hostile = [
      `| ${'['.repeat(50_000)} | 1 | |`,
      `| [${'a'.repeat(50_000)}](https://x) | 1 | |`,
      `| [a](https://${'a'.repeat(50_000)}) | 1 | |`,
      `| [a](https://x) | ${'1'.repeat(50_000)} | |`,
      `|${' |'.repeat(25_000)}`,
      `| [a](${'https://'.repeat(10_000)}) | 1 | |`,
    ].join('\n');
    const started = performance.now();
    expect(parseBooksTable(hostile)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(200);
  });
});
