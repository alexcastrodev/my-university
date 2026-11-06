/** A book as the public profile shows it. `comment` is plain text, paragraphs separated by `\n`. */
export interface PublicBook {
  title: string;
  url: string;
  pages: number;
  cover?: string;
  comment?: string;
}

const MAX_LINES = 1000;
const MAX_LINE_CHARS = 1500;
export const MAX_BOOKS = 200;
const MAX_TITLE = 200;
const MIN_PAGES = 1;
const MAX_PAGES = 5000;
export const MAX_COMMENT_LINES = 4;
export const MAX_COMMENT_CHARS = 500;

// Every quantifier is bounded or runs over a capped line, and every pattern is anchored, so matching time is linear.
const URL_PART = String.raw`https:\/\/[^\s()<>"']{1,500}`;
const TITLE_CELL = new RegExp(String.raw`^\[([^\[\]]{1,${MAX_TITLE}})\]\((${URL_PART})\)$`);
const URL_CELL = new RegExp(`^${URL_PART}$`);
const PAGES_CELL = /^\d{1,4}$/;
const KEY_LINE = /^(title|url|pages|cover|comment)[ \t]*:[ \t]*(.*)$/i;
const SEPARATOR = /^-{3,}$/;
/** Control, format (zero-width, right-to-left override) and unassigned characters. */
const INVISIBLE = /\p{C}/u;

/** What a book is made of before it is checked: the same shape whether it came from a table row or from lines. */
interface Fields {
  title?: string;
  url?: string;
  pages?: string;
  cover?: string;
  comment: string[];
}

/** The URL in its normal form if it is plain `https:` (no user or password in it), else nothing. */
function httpsUrl(value: string): string | undefined {
  if (!URL_CELL.test(value)) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Plain text of 1..max characters with nothing invisible in it, else nothing. */
function plainText(value: string | undefined, max: number): string | undefined {
  const text = value?.trim();
  return text && text.length <= max && !INVISIBLE.test(text) ? text : undefined;
}

/** The book if every field passes its rule, else nothing: one broken field costs that book, never the file. */
function toBook(fields: Fields): PublicBook | undefined {
  const title = plainText(fields.title, MAX_TITLE);
  const url = httpsUrl(fields.url ?? '');
  if (!title || !url || !PAGES_CELL.test(fields.pages ?? '')) return undefined;
  const pages = Number(fields.pages);
  if (pages < MIN_PAGES || pages > MAX_PAGES) return undefined;
  const book: PublicBook = { title, url, pages };
  if (fields.cover) {
    const cover = httpsUrl(fields.cover);
    if (!cover) return undefined;
    book.cover = cover;
  }
  if (fields.comment.length > 0) {
    const paragraphs = fields.comment.map((line) => plainText(line, MAX_COMMENT_CHARS));
    if (paragraphs.length > MAX_COMMENT_LINES || paragraphs.some((p) => p === undefined)) return undefined;
    book.comment = paragraphs.join('\n');
  }
  return book;
}

function fromTableRow(line: string): PublicBook | undefined {
  const cells = line.slice(1, -1).split('|').map((cell) => cell.trim());
  if (cells.length !== 3) return undefined;
  const link = TITLE_CELL.exec(cells[0]);
  if (!link) return undefined;
  return toBook({ title: link[1], url: link[2], pages: cells[1], cover: cells[2], comment: [] });
}

/** `"quoted"` values lose the quotes, so a title written like YAML still reads right. */
function unquote(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1).trim() : value;
}

/**
 * The books in a file written by a person, in two shapes that can be mixed. A block of lines per book, between
 * `---` lines like the metadata at the top of a concept:
 *
 *     ---
 *     title: Designing Data-Intensive Applications
 *     url: https://dataintensive.net/
 *     pages: 616
 *     cover: https://example.com/cover.jpg
 *     comment: Plain text. Each comment line is a paragraph.
 *     ---
 *
 * or a table row per book, `| [Title](https://book-link) | 616 | https://cover |`. A block ends at a `---` line,
 * a blank line, a table row or the end of the file, and a new `title:` line also starts a new book. Not a
 * markdown or YAML parser: it only looks at table rows and `key: value` lines for those
 * five keys and ignores everything else (headings, code fences, other keys, text around). A book with any broken
 * field (a repeated key, a link that is not `https:`, pages out of 1..5000, a comment with more than 4 lines
 * or 500 characters a line, invisible characters) is skipped and the others stay. It reads at most 1000 lines and
 * keeps at most 200 books. Each book is built field by field from validated values, so nothing from the file but
 * those fields can reach the page, and the comment is text to show with `textContent`, never markup.
 */
export function parseBooks(text: string): PublicBook[] {
  const books: PublicBook[] = [];
  let fields: Fields = { comment: [] };
  let broken = false;
  const add = (book: PublicBook | undefined) => {
    if (book && books.length < MAX_BOOKS) books.push(book);
  };
  const flush = () => {
    if (!broken) add(toBook(fields));
    fields = { comment: [] };
    broken = false;
  };

  for (const raw of text.split('\n', MAX_LINES)) {
    if (books.length >= MAX_BOOKS) break;
    const line = raw.trim();
    if (line.length > MAX_LINE_CHARS) continue;
    if (line === '' || SEPARATOR.test(line)) {
      flush();
    } else if (line.length >= 5 && line[0] === '|' && line[line.length - 1] === '|') {
      flush();
      add(fromTableRow(line));
    } else {
      const match = KEY_LINE.exec(line);
      if (!match) continue;
      const key = match[1].toLowerCase() as 'title' | 'url' | 'pages' | 'cover' | 'comment';
      const value = unquote(match[2].trim());
      if (key === 'title' && fields.title !== undefined) flush();
      if (key === 'comment') {
        if (value) fields.comment.push(value);
      } else if (fields[key] !== undefined) {
        broken = true;
      } else {
        fields[key] = value;
      }
    }
  }
  flush();
  return books;
}
