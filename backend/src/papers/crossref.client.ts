import { HttpException, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PaperInputDto } from './paper.dto';
import { PaperType } from './paper.entity';
import { normalizeDoi } from './paper.normalize';

/** What the provider answered, mapped to the canonical paper model, plus the identifier it knows it by. */
export interface ProviderRecord {
  input: PaperInputDto;
  /** The provider's own identifier for the record (Crossref: the DOI as it registered it). */
  externalId: string;
  retrievedAt: Date;
}

/**
 * Provider failures, each with a stable `code` the client can branch on. None of them is a dead end for the
 * user: manual creation does not go through the provider at all.
 */
export class ProviderNotFoundException extends HttpException {
  constructor() {
    super(
      {
        statusCode: 404,
        code: 'not_found',
        message: 'Crossref has no record for this DOI',
      },
      404,
    );
  }
}
export class ProviderRateLimitedException extends HttpException {
  constructor(readonly retryAfter: number) {
    super(
      {
        statusCode: 429,
        code: 'rate_limited',
        message: 'Crossref is asking for fewer requests, try again shortly',
        retryAfter,
      },
      429,
    );
  }
}
export class ProviderUnavailableException extends HttpException {
  constructor(message = 'Crossref could not be reached') {
    super({ statusCode: 502, code: 'provider_unavailable', message }, 502);
  }
}
export class ProviderInvalidException extends HttpException {
  constructor(message: string) {
    super({ statusCode: 502, code: 'provider_invalid', message }, 502);
  }
}

const TIMEOUT_MS = 8000;
const MAX_BODY_CHARS = 4_000_000;
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 200;

interface CrossrefMessage {
  DOI?: string;
  title?: string[];
  subtitle?: string[];
  abstract?: string;
  author?: { given?: string; family?: string; name?: string; ORCID?: string }[];
  issued?: { 'date-parts'?: (number | null)[][] };
  'container-title'?: string[];
  event?: { name?: string };
  type?: string;
  subject?: string[];
  resource?: { primary?: { URL?: string } };
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Decodes the entities in one pass, so `&amp;lt;` stays `&lt;` instead of becoming `<`. */
function decode(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1].toLowerCase() === 'x'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * Drops every tag in one pass: a `<` followed by a letter, `/`, `!` or `?` opens one and runs to the next `>`.
 * A `<` that is not followed by one of those ("p < 0.05") is text and stays. No `<` is left in front of a letter,
 * so a tag cannot be rebuilt out of what is left (`<scr<b>ipt>` loses all of `<scr<b>`).
 */
function stripTags(markup: string): string {
  let text = '';
  for (let i = 0; i < markup.length; i++) {
    if (markup[i] === '<' && /[a-z/!?]/i.test(markup[i + 1] ?? '')) {
      const end = markup.indexOf('>', i + 1);
      if (end === -1) return text + markup.slice(i);
      i = end;
    } else {
      text += markup[i];
    }
  }
  return text;
}

/** Crossref text carries JATS/MathML markup; the catalog keeps plain text, paragraphs split by a blank line. */
export function plainText(markup: string): string {
  return decode(
    stripTags(
      markup
        .replace(/<jats:title>[\s\S]*?<\/jats:title>/gi, '')
        .replace(/<\/(?:jats:)?p>|<br\s*\/?>/gi, '\n\n'),
    ),
  )
    .replace(/\u0000/g, '')
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

const TYPES: Record<string, PaperType> = {
  'journal-article': 'journal-article',
  'proceedings-article': 'conference-paper',
  'posted-content': 'preprint',
  'book-chapter': 'book-chapter',
  'book-section': 'book-chapter',
  'book-part': 'book-chapter',
  book: 'book',
  monograph: 'book',
  'edited-book': 'book',
  'reference-book': 'book',
  dissertation: 'thesis',
  report: 'report',
  'report-component': 'report',
};

function dateOf(message: CrossrefMessage): string | undefined {
  const [year, month, day] = message.issued?.['date-parts']?.[0] ?? [];
  if (!year || year < 1000 || year > 9999) return undefined;
  const mm = month && month >= 1 && month <= 12 ? month : null;
  if (!mm) return String(year);
  const dd = day && day >= 1 && day <= 31 ? day : null;
  const base = `${year}-${String(mm).padStart(2, '0')}`;
  return dd ? `${base}-${String(dd).padStart(2, '0')}` : base;
}

function webUrl(url: string | undefined): string | undefined {
  if (!url || url.length > 2000) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? parsed.href
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Crossref's work record as a canonical paper. Limits are enforced here because this object never goes
 * through request validation. The publisher's full-text `link` entries are deliberately ignored: importing
 * metadata never means fetching or pointing at a publisher PDF.
 */
export function mapCrossref(message: CrossrefMessage): PaperInputDto {
  const title = [message.title?.[0], message.subtitle?.[0]]
    .filter((t): t is string => !!t)
    .map(plainText)
    .filter(Boolean);
  if (!title.length) throw new ProviderInvalidException('The record has no title');
  const doi = message.DOI ? normalizeDoi(message.DOI) : null;

  const authors = (message.author ?? [])
    .slice(0, 500)
    .map((a) => ({
      name: plainText(
        [a.given, a.family].filter(Boolean).join(' ') || a.name || '',
      ).slice(0, 200),
      orcid: a.ORCID?.match(/\d{4}-\d{4}-\d{4}-\d{3}[\dX]/)?.[0],
    }))
    .filter((a) => a.name);
  const keywords = [
    ...new Set(
      (message.subject ?? [])
        .map((s) => plainText(s).slice(0, 100))
        .filter(Boolean),
    ),
  ].slice(0, 50);
  const venue = plainText(
    message['container-title']?.[0] ?? message.event?.name ?? '',
  ).slice(0, 500);
  const abstract = message.abstract
    ? plainText(message.abstract).slice(0, 20000)
    : '';

  const input = plainToInstance(PaperInputDto, {
    title: (title.length > 1 && !title[0].includes(title[1])
      ? `${title[0]}: ${title[1]}`
      : title[0]
    ).slice(0, 1000),
    abstract: abstract || undefined,
    doi: doi ?? undefined,
    venue: venue || undefined,
    publicationDate: dateOf(message),
    url: webUrl(message.resource?.primary?.URL),
    type: TYPES[message.type ?? ''] ?? 'other',
    authors: authors.length ? authors : undefined,
    keywords: keywords.length ? keywords : undefined,
  });
  if (validateSync(input).length) {
    throw new ProviderInvalidException('The record could not be understood');
  }
  return input;
}

/** `10.1002/(sici)...<693::aid>` has characters a URL path cannot carry as they are. */
const doiPath = (doi: string) =>
  doi.split('/').map(encodeURIComponent).join('/');

/**
 * Crossref is the DOI metadata provider: free, no key. `CROSSREF_MAILTO` (optional, server side only) moves
 * requests to Crossref's polite pool; `CROSSREF_BASE_URL` points tests at a stub. Successful lookups are kept
 * for a few minutes, so the preview and the import that follows it see the same record and cost one request.
 *
 * ponytail: per-process cache; share it (Redis) only if several API replicas make the repeat lookups matter.
 */
@Injectable()
export class CrossrefClient {
  private readonly cache = new Map<
    string,
    { record: ProviderRecord; expiresAt: number }
  >();

  async lookup(doi: string): Promise<ProviderRecord> {
    const hit = this.cache.get(doi);
    if (hit && hit.expiresAt > Date.now()) return hit.record;

    const base = process.env.CROSSREF_BASE_URL ?? 'https://api.crossref.org';
    const mailto = process.env.CROSSREF_MAILTO;
    const url = `${base}/works/${doiPath(doi)}${mailto ? `?mailto=${encodeURIComponent(mailto)}` : ''}`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': `MyUniversity/1.0 (https://university.kurz.fyi${mailto ? `; mailto:${mailto}` : ''})`,
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
    } catch {
      throw new ProviderUnavailableException();
    }
    if (res.status === 404) throw new ProviderNotFoundException();
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after'));
      throw new ProviderRateLimitedException(
        Number.isFinite(wait) && wait > 0 ? Math.min(wait, 300) : 30,
      );
    }
    if (!res.ok) throw new ProviderUnavailableException();

    let message: CrossrefMessage;
    try {
      const body = await res.text();
      if (body.length > MAX_BODY_CHARS) throw new Error('too large');
      message = (JSON.parse(body) as { message?: CrossrefMessage }).message ?? {};
    } catch {
      throw new ProviderInvalidException('The answer was not a Crossref record');
    }
    const input = mapCrossref(message);
    const record: ProviderRecord = {
      input,
      externalId: input.doi ?? doi,
      retrievedAt: new Date(),
    };
    this.cache.set(doi, { record, expiresAt: Date.now() + CACHE_TTL_MS });
    if (this.cache.size > CACHE_MAX) {
      this.cache.delete(this.cache.keys().next().value!);
    }
    return record;
  }
}
