import { describe, expect, it } from 'vitest';
import { MAX_BOOKS, parseBooks } from '../src/books/parse-books';

// Pure: the table a person writes in public/books/<github>.md, turned into the books the profile shows.

const COVER = 'https://covers.openlibrary.org/b/isbn/9781449373320-L.jpg';
const row = (title: string, pages: string | number, cover = '') => `| ${title} | ${pages} | ${cover} |`;
const link = (title: string, url = 'https://example.com/book') => `[${title}](${url})`;

describe('parseBooks', () => {
  it('reads the table of the documented format, header and separator included', () => {
    const text = [
      '| Livro | Páginas | Capa |',
      '| --- | --- | --- |',
      row(link('Designing Data-Intensive Applications', 'https://dataintensive.net/'), 616, COVER),
      row(link('Clean Code'), 464),
    ].join('\n');
    expect(parseBooks(text)).toEqual([
      { title: 'Designing Data-Intensive Applications', url: 'https://dataintensive.net/', pages: 616, cover: COVER },
      { title: 'Clean Code', url: 'https://example.com/book', pages: 464 },
    ]);
  });

  it('ignores text around the table and accepts Windows line endings', () => {
    const text = `# My books\r\n\r\nSome words.\r\n${row(link('A'), 100)}\r\n\r\nMore words.\r\n`;
    expect(parseBooks(text).map((b) => b.title)).toEqual(['A']);
  });

  it('returns nothing for text with no table', () => {
    expect(parseBooks('')).toEqual([]);
    expect(parseBooks('just text\n- a list\n')).toEqual([]);
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
    expect(parseBooks(text).map((b) => b.title)).toEqual(['Good one', 'Last good one']);
  });

  it('wants exactly three cells', () => {
    const text = [
      `| ${link('Two cells')} | 100 |`,
      `| ${link('Four cells')} | 100 | | extra |`,
      `${link('No pipes')} | 100 | `,
      row(link('Fine'), 100),
    ].join('\n');
    expect(parseBooks(text).map((b) => b.title)).toEqual(['Fine']);
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
    expect(parseBooks(text).map((b) => b.title)).toEqual(['Café Olé']);
  });

  it('keeps the title as plain text, markup and all', () => {
    const [book] = parseBooks(row(link('<img src=x onerror=alert(1)>'), 100));
    expect(book.title).toBe('<img src=x onerror=alert(1)>');
  });

  it('returns a clean object with only the allowed fields, even for names like __proto__', () => {
    const [book] = parseBooks(row(link('__proto__'), 100));
    expect(Object.keys(book).sort()).toEqual(['pages', 'title', 'url']);
    expect(book.title).toBe('__proto__');
    expect(Object.getPrototypeOf(book)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).title).toBeUndefined();
  });

  it('keeps at most 200 books', () => {
    const text = Array.from({ length: 300 }, (_, i) => row(link(`Book ${i}`), 100)).join('\n');
    const books = parseBooks(text);
    expect(books).toHaveLength(MAX_BOOKS);
    expect(books[199].title).toBe('Book 199');
  });

  it('reads no more than 1000 lines', () => {
    const text = `${'\n'.repeat(1000)}${row(link('Too late'), 100)}`;
    expect(parseBooks(text)).toEqual([]);
  });

  it('drops a row with an address over 500 characters', () => {
    const long = `https://example.com/${'a'.repeat(500)}`;
    expect(parseBooks(row(link('Long link', long), 100))).toEqual([]);
    expect(parseBooks(row(link('Long cover'), 100, long))).toEqual([]);
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
    expect(parseBooks(hostile)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

// The same books written as lines, like the metadata at the top of a concept.
const block = (title: string, extra: string[] = [], url = 'https://example.com/book', pages: string | number = 100) =>
  [`title: ${title}`, `url: ${url}`, `pages: ${pages}`, ...extra].join('\n');

describe('parseBooks, line format', () => {
  it('reads a block of lines per book, with an optional cover and comment', () => {
    const text = [
      block('Designing Data-Intensive Applications', [`cover: ${COVER}`, 'comment: The best book on how data systems work.'], 'https://dataintensive.net/', 616),
      '',
      block('Clean Code', [], undefined, 464),
    ].join('\n');
    expect(parseBooks(text)).toEqual([
      { title: 'Designing Data-Intensive Applications', url: 'https://dataintensive.net/', pages: 616, cover: COVER, comment: 'The best book on how data systems work.' },
      { title: 'Clean Code', url: 'https://example.com/book', pages: 464 },
    ]);
  });

  it('separates books by a blank line, a --- line, a table row or a new title', () => {
    const text = [block('One'), '---', block('Two'), '', block('Three'), row(link('Four'), 10), block('Five'), block('Six')].join('\n');
    expect(parseBooks(text).map((b) => b.title)).toEqual(['One', 'Two', 'Three', 'Four', 'Five', 'Six']);
  });

  it('reads books wrapped in --- lines, like the metadata at the top of a concept', () => {
    const text = ['---', 'title: A', 'url: https://example.com/a', 'pages: 10', '---', '', '---', 'title: B', 'url: https://example.com/b', 'pages: 20', 'cover: ' + COVER, 'comment: Good.', '---', ''].join('\n');
    expect(parseBooks(text)).toEqual([
      { title: 'A', url: 'https://example.com/a', pages: 10 },
      { title: 'B', url: 'https://example.com/b', pages: 20, cover: COVER, comment: 'Good.' },
    ]);
  });

  it('mixes tables and blocks and keeps the order of the file', () => {
    const text = [row(link('Table first'), 10), '', block('Lines second'), '', row(link('Table third'), 10)].join('\n');
    expect(parseBooks(text).map((b) => b.title)).toEqual(['Table first', 'Lines second', 'Table third']);
  });

  it('accepts any order of keys, upper case keys, spaces before the colon and Windows line endings', () => {
    const text = 'PAGES : 300\r\nUrl:https://example.com/b\r\nTitle:   Java: The Complete Reference\r\n';
    expect(parseBooks(text)).toEqual([{ title: 'Java: The Complete Reference', url: 'https://example.com/b', pages: 300 }]);
  });

  it('strips one pair of double quotes, as a YAML habit would write them', () => {
    const [book] = parseBooks(block('"Quoted: title"', ['comment: "Said it well"']));
    expect(book.title).toBe('Quoted: title');
    expect(book.comment).toBe('Said it well');
  });

  it('ignores headings, code fences, unknown keys and text around the blocks', () => {
    const text = ['# My books', '```yaml', 'title: In a fence', 'author: Someone', 'url: https://example.com/a', 'pages: 50', 'year: 1999', '```', 'Some words.'].join('\n');
    expect(parseBooks(text)).toEqual([{ title: 'In a fence', url: 'https://example.com/a', pages: 50 }]);
  });

  it('skips a block with a missing field or a repeated key, and keeps the others', () => {
    const text = [
      'title: No pages\nurl: https://example.com/a',
      'title: No link\npages: 10',
      'url: https://example.com/a\npages: 10',
      `${block('Two pages')}\npages: 20`,
      `${block('Two links')}\nurl: https://example.com/other`,
      `${block('Two covers')}\ncover: ${COVER}\ncover: ${COVER}`,
      block('Fine'),
    ].join('\n\n');
    expect(parseBooks(text).map((b) => b.title)).toEqual(['Fine']);
  });

  it('applies the same rules to links, cover and pages as the table', () => {
    const text = [
      block('Http link', [], 'http://example.com/a'),
      block('Script link', [], 'javascript:alert(1)'),
      block('Credentials', [], 'https://user:secret@example.com/a'),
      block('Http cover', ['cover: http://example.com/c.jpg']),
      block('Script cover', ['cover: javascript:alert(1)']),
      block('Zero pages', [], undefined, 0),
      block('Too many pages', [], undefined, 5001),
      block('Word pages', [], undefined, 'abc'),
      block('Long link', [], `https://example.com/${'a'.repeat(500)}`),
      block('Empty cover', ['cover:']),
    ].join('\n\n');
    expect(parseBooks(text).map((b) => b.title)).toEqual(['Empty cover']);
  });

  it('refuses invisible characters in the title and in the comment', () => {
    const text = [
      block('Zero​width'),
      block('Right‮to left'),
      block('Fine one', ['comment: has a zero​width space']),
      block('Fine two', ['comment: has a right‮to left mark']),
      block('Café Olé', ['comment: Não é só teoria, é prática.']),
    ].join('\n\n');
    const books = parseBooks(text);
    expect(books.map((b) => b.title)).toEqual(['Café Olé']);
    expect(books[0].comment).toBe('Não é só teoria, é prática.');
  });

  it('keeps the comment as plain text, markup and all', () => {
    const [book] = parseBooks(block('A', ['comment: <img src=x onerror=alert(1)> <script>alert(1)</script> [x](javascript:alert(1))']));
    expect(book.comment).toBe('<img src=x onerror=alert(1)> <script>alert(1)</script> [x](javascript:alert(1))');
  });

  it('turns each comment line into a paragraph, up to 4 of up to 500 characters', () => {
    const lines = ['comment: First.', 'comment: Second.', 'comment:', 'comment: Third.', 'comment: Fourth.'];
    expect(parseBooks(block('A', lines))[0].comment).toBe('First.\nSecond.\nThird.\nFourth.');
    expect(parseBooks(block('A', [...lines, 'comment: Fifth.']))).toEqual([]);
    expect(parseBooks(block('A', [`comment: ${'a'.repeat(500)}`]))[0].comment).toHaveLength(500);
    expect(parseBooks(block('A', [`comment: ${'a'.repeat(501)}`]))).toEqual([]);
  });

  it('has no comment when the line is empty', () => {
    expect(parseBooks(block('A', ['comment:   ']))[0]).toEqual({ title: 'A', url: 'https://example.com/book', pages: 100 });
  });

  it('returns a clean object with only the allowed fields, even for keys and titles like __proto__', () => {
    const text = `${block('__proto__', ['comment: constructor'])}\n__proto__: x\nconstructor: y\nprototype: z`;
    const [book] = parseBooks(text);
    expect(Object.keys(book).sort()).toEqual(['comment', 'pages', 'title', 'url']);
    expect(book.title).toBe('__proto__');
    expect(Object.getPrototypeOf(book)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).title).toBeUndefined();
  });

  it('keeps at most 200 books and reads at most 1000 lines', () => {
    const many = Array.from({ length: 300 }, (_, i) => block(`Book ${i}`)).join('\n\n');
    const books = parseBooks(many);
    expect(books).toHaveLength(MAX_BOOKS);
    expect(books[199].title).toBe('Book 199');
    expect(parseBooks(`${'\n'.repeat(1000)}${block('Too late')}`)).toEqual([]);
  });

  it('stays fast on hostile lines', () => {
    const hostile = [
      `title: ${'['.repeat(50_000)}`,
      `title: ${'a'.repeat(50_000)}\nurl: https://x\npages: 1`,
      `title: a\nurl: https://${'a'.repeat(50_000)}\npages: 1`,
      `title: a\nurl: https://x\npages: ${'1'.repeat(50_000)}`,
      `comment${' '.repeat(50_000)}:`,
      `${'title: '.repeat(10_000)}`,
      `${':'.repeat(50_000)}`,
      `${'-'.repeat(50_000)}`,
      'title: a\n'.repeat(900),
    ].join('\n\n');
    const started = performance.now();
    expect(parseBooks(hostile)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(200);
  });
});
