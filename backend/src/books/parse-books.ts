/** A book as the public profile shows it. */
export interface PublicBook {
  title: string;
  url: string;
  pages: number;
  cover?: string;
}

const MAX_LINES = 1000;
const MAX_LINE_CHARS = 1500;
export const MAX_BOOKS = 200;
const MIN_PAGES = 1;
const MAX_PAGES = 5000;

// Every quantifier is bounded and every pattern anchored, so matching time is linear in the (capped) line.
const URL_PART = String.raw`https:\/\/[^\s()<>"']{1,500}`;
const TITLE_CELL = new RegExp(String.raw`^\[([^\[\]]{1,200})\]\((${URL_PART})\)$`);
const URL_CELL = new RegExp(`^${URL_PART}$`);
const PAGES_CELL = /^\d{1,4}$/;
/** Control, format (zero-width, right-to-left override) and unassigned characters. */
const INVISIBLE = /\p{C}/u;

/** The URL in its normal form if it is plain `https:` (no user or password in it), else nothing. */
function httpsUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function toBook(titleCell: string, pagesCell: string, coverCell: string): PublicBook | undefined {
  const match = TITLE_CELL.exec(titleCell);
  if (!match) return undefined;
  const title = match[1].trim();
  if (!title || INVISIBLE.test(title)) return undefined;
  const url = httpsUrl(match[2]);
  if (!url) return undefined;
  if (!PAGES_CELL.test(pagesCell)) return undefined;
  const pages = Number(pagesCell);
  if (pages < MIN_PAGES || pages > MAX_PAGES) return undefined;
  if (!coverCell) return { title, url, pages };
  const cover = URL_CELL.test(coverCell) ? httpsUrl(coverCell) : undefined;
  return cover ? { title, url, pages, cover } : undefined;
}

/**
 * The books in a markdown table written by a person: one row per book, `| [Title](https://book-link) | 616 | https://cover |`.
 * Not a markdown parser: it reads lines that start and end with `|` and have three cells, and ignores everything else
 * (the header, the `---` row, any text around the table, and any row that breaks a rule), so one typo costs one
 * book and never the whole file. It reads at most 1000 lines and keeps at most 200 books. The result is built field by
 * field from validated values, so nothing from the file but those fields can reach the page.
 */
export function parseBooksTable(text: string): PublicBook[] {
  const books: PublicBook[] = [];
  for (const raw of text.split('\n', MAX_LINES)) {
    if (books.length >= MAX_BOOKS) break;
    const line = raw.trim();
    if (line.length < 5 || line.length > MAX_LINE_CHARS || line[0] !== '|' || line[line.length - 1] !== '|') continue;
    const cells = line.slice(1, -1).split('|').map((cell) => cell.trim());
    if (cells.length !== 3) continue;
    const book = toBook(cells[0], cells[1], cells[2]);
    if (book) books.push(book);
  }
  return books;
}
