import { inflateSync } from 'node:zlib';

/** Why a file was refused. Stable codes: clients and tests branch on them, the message is for people. */
export type ScanCode =
  | 'not_pdf'
  | 'malformed'
  | 'encrypted'
  | 'active_content'
  | 'too_many_pages'
  | 'unscannable';

export type ScanVerdict =
  | { ok: true }
  | { ok: false; code: ScanCode; reason: string };

const HEADER = /^%PDF-(?:1\.[0-7]|2\.0)$/;
const TAIL_BYTES = 2048;

// PDF names end at whitespace or one of these delimiters, so `/JSON` is not `/JS`.
const NAME_END = String.raw`(?=[\s()<>\[\]{}/%]|$)`;
// Features that run code or reach outside the file. A paper has none of them.
const ACTIVE = new RegExp(
  String.raw`/(JavaScript|JS|Launch|RichMedia|XFA|SubmitForm|ImportData)${NAME_END}`,
);
const ENCRYPT = new RegExp(String.raw`/Encrypt${NAME_END}`);
const OBJECT_STREAM = new RegExp(String.raw`/ObjStm${NAME_END}`);
const FLATE = new RegExp(String.raw`/(?:FlateDecode|Fl)${NAME_END}`);
// A page object. `/Type /Pages` (the tree) does not match, and the count is made from the objects themselves,
// never from the `/Count` the file claims.
const PAGE = new RegExp(String.raw`/Type\s*/Page${NAME_END}`, 'g');

// Object streams are where a PDF hides dictionaries from a plain-text search. Inflating them is bounded
// so a small file cannot expand into a memory bomb.
const MAX_STREAM_OUTPUT = 64 * 1024 * 1024;
const MAX_TOTAL_OUTPUT = 128 * 1024 * 1024;

/** Most pages a PDF may have (`PAPER_PDF_MAX_PAGES`): a paper is a few dozen, a thesis a few hundred. */
const maxPages = () => Number(process.env.PAPER_PDF_MAX_PAGES) || 2000;
/** How long the scan may run (`PAPER_PDF_SCAN_TIMEOUT_MS`): it runs on the request thread, so it must not hold it. */
const scanBudgetMs = () => Number(process.env.PAPER_PDF_SCAN_TIMEOUT_MS) || 5000;

const pagesIn = (text: string) => text.match(PAGE)?.length ?? 0;

/** `/J#61vaScript` is `/JavaScript`: undo the `#xx` escapes before looking for names. */
const unescapeNames = (text: string) =>
  text.replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );

const refuse = (code: ScanCode, reason: string): ScanVerdict => ({
  ok: false,
  code,
  reason,
});

/**
 * Static checks on an untrusted PDF, from the bytes alone. Not an antivirus and not a full parser: it
 * decides from the content (never from the declared type or the extension) whether this is a PDF worth
 * keeping, and refuses what runs code, cannot be inspected, or is cut short.
 *
 *   1. The file starts with `%PDF-1.x` or `%PDF-2.0` at byte 0 (a file that only contains one later is
 *      a polyglot, not a PDF).
 *   2. It ends like a PDF: `startxref`, an offset and `%%EOF` near the end, and it has objects.
 *   3. It is not encrypted, because its streams could not be inspected.
 *   4. No code or external-reach feature (`/JavaScript`, `/JS`, `/Launch`, `/RichMedia`, `/XFA`,
 *      `/SubmitForm`, `/ImportData`) appears, in the file or in any object stream, after undoing `#xx`
 *      name escapes. An object stream that cannot be inflated is refused too: fail closed.
 *   5. It has no more than `PAPER_PDF_MAX_PAGES` page objects (counted in the file and in the object
 *      streams, not taken from its `/Count`), and the scan itself ends within `PAPER_PDF_SCAN_TIMEOUT_MS`
 *      (a file built to make it slow is refused as unscannable).
 *
 * ponytail: runs on the request thread (a few ms per MB). Move to a worker thread or an external
 * scanner such as ClamAV when uploads get large or frequent; the pending state already allows it.
 */
export function scanPdf(bytes: Buffer): ScanVerdict {
  if (!HEADER.test(bytes.subarray(0, 8).toString('latin1'))) {
    return refuse(
      'not_pdf',
      'The file is not a PDF: it does not start with a PDF header.',
    );
  }

  // `raw` keeps stream bytes intact; only `text` has its name escapes undone, for name matching.
  const raw = bytes.toString('latin1');
  const text = unescapeNames(raw);
  const tail = raw.slice(-TAIL_BYTES);
  const eof = tail.lastIndexOf('%%EOF');
  if (
    eof === -1 ||
    !/startxref\s+\d+\s*$/.test(tail.slice(0, eof)) ||
    !/\bendobj\b/.test(raw)
  ) {
    return refuse(
      'malformed',
      'The PDF is damaged or cut short: it has no valid ending or no objects.',
    );
  }

  if (ENCRYPT.test(text)) {
    return refuse(
      'encrypted',
      'Encrypted PDFs are not accepted. Remove the restrictions and upload it again.',
    );
  }
  if (ACTIVE.test(text)) return refuse('active_content', ACTIVE_MESSAGE);

  const pages = pagesIn(text);
  if (pages > maxPages()) return tooManyPages();
  return scanObjectStreams(raw, pages);
}

const tooManyPages = (): ScanVerdict =>
  refuse('too_many_pages', `The PDF has more than ${maxPages()} pages, which is more than is accepted.`);

const ACTIVE_MESSAGE =
  'The PDF contains scripts or actions that open files or forms, which are not accepted.';

/**
 * Looks inside every compressed object stream for the same features, and counts the pages that hide there.
 * `text` is the file as latin1, untouched; `pages` is what the plain text already held.
 */
function scanObjectStreams(text: string, pages: number): ScanVerdict {
  const deadline = Date.now() + scanBudgetMs();
  let total = 0;
  let from = 0;
  for (;;) {
    if (Date.now() > deadline) {
      return refuse('unscannable', 'The PDF took too long to check, so it was not accepted.');
    }
    const stream = text.indexOf('stream', from);
    if (stream === -1) return { ok: true };
    const end = text.indexOf('endstream', stream + 6);
    if (end === -1)
      return refuse('malformed', 'The PDF has a stream that never ends.');
    from = end + 9;

    // `endstream` also contains the word `stream`; a real stream keyword follows `>>` and precedes EOL.
    const before = text.slice(Math.max(0, stream - 4096), stream);
    const dictStart = before.lastIndexOf('obj');
    const dict = dictStart === -1 ? '' : unescapeNames(before.slice(dictStart));
    if (!/>>\s*$/.test(dict) || !OBJECT_STREAM.test(dict)) continue;

    if (!FLATE.test(dict)) {
      return refuse(
        'unscannable',
        'The PDF has a compressed section this check cannot read.',
      );
    }
    const start =
      text.slice(stream + 6, stream + 8) === '\r\n' ? stream + 8 : stream + 7;
    let decoded: string;
    try {
      const out = inflateSync(Buffer.from(text.slice(start, end), 'latin1'), {
        maxOutputLength: MAX_STREAM_OUTPUT,
      });
      total += out.length;
      if (total > MAX_TOTAL_OUTPUT) throw new RangeError('too much data');
      decoded = unescapeNames(out.toString('latin1'));
    } catch {
      return refuse(
        'unscannable',
        'The PDF has a compressed section this check cannot read.',
      );
    }
    if (ACTIVE.test(decoded)) return refuse('active_content', ACTIVE_MESSAGE);
    pages += pagesIn(decoded);
    if (pages > maxPages()) return tooManyPages();
  }
}
