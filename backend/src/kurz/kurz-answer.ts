import { normalizeForMatch } from '../discussion/discussion.logic';
import type { KurzSource } from './kurz-sources';

export type KurzBlockKind = 'claim' | 'example' | 'question';

/** A citation as the student sees it: the number is ours, and the route and the section come from our sources. */
export interface KurzCitation {
  n: number;
  source: string;
  title: string;
  route: string[];
  section: string;
  p: number;
  /** Literal text of the cited block (checked), what the page looks for to scroll to and highlight. */
  quote: string;
}

export interface KurzAnswerBlock {
  kind: KurzBlockKind;
  text: string;
  /** The `n` of each citation, in `KurzAnswer.citations`. */
  cites: number[];
}

export interface KurzSee {
  source: string;
  title: string;
  route: string[];
}

export interface KurzAnswer {
  answerable: boolean;
  blocks: KurzAnswerBlock[];
  citations: KurzCitation[];
  see: KurzSee[];
  followUps: string[];
}

/**
 * `answered`: at least one verified claim or example. `refused`: the model said the sources do not cover it.
 * `unverified`: it answered, but nothing of it survived the checks (or it was not the JSON asked for), so none of it
 * is shown. The student sees the same fixed message for both of the last two; the difference is for the reports.
 */
export type KurzOutcome = 'answered' | 'refused' | 'unverified';

export interface ValidatedAnswer {
  answer: KurzAnswer;
  outcome: KurzOutcome;
  /** How many blocks and citations the checks threw away. */
  dropped: number;
}

export const MAX_BLOCKS = 3;
export const MAX_CITES_PER_BLOCK = 3;
export const MAX_BLOCK_TEXT_CHARS = 1200;
export const MAX_QUOTE_CHARS = 400;
/** A quote with fewer letters and digits than this proves nothing: it would be found in any text. */
export const MIN_QUOTE_CHARS = 8;
export const MAX_FOLLOW_UPS = 3;
export const MAX_FOLLOW_UP_CHARS = 80;
export const MAX_SEE = 3;
/**
 * A `question` block has no citation to check, so it is the one place where text the model wrote freely reaches
 * the student (and, through "Partilhar na discussão", the public discussion). It is kept to what it is for: one short
 * question, on one line, ending in a question mark.
 */
export const MAX_QUESTION_BLOCK_CHARS = 200;

const REFUSED: KurzAnswer = {
  answerable: false,
  blocks: [],
  citations: [],
  see: [],
  followUps: [],
};

/**
 * What the model wrote must never carry a link: the page renders no link or image from it, and the text may be
 * published in the public discussion, where a link would be live. Links come from our own table (`see`, citations).
 */
export function stripLinks(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<?\bhttps?:\/\/[^\s)>\]]+>?/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The only door between the model and the student. Nothing is shown that this did not accept: `source` and `p`
 * must exist in this question, `quote` must be text of the cited block (letters and digits, as the discussion
 * quotes are checked), a claim or an example without a valid citation is dropped, and what is left is rebuilt
 * from our own data. A model that is wrong, or was told to lie, ends in the fixed refusal and not in a bad answer.
 */
export function validateAnswer(
  rawText: string | null,
  sources: KurzSource[],
): ValidatedAnswer {
  const unverified = (dropped = 0): ValidatedAnswer => ({
    answer: REFUSED,
    outcome: 'unverified',
    dropped,
  });
  if (!rawText) return unverified();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return unverified();
  }
  if (!isRecord(parsed)) return unverified();

  const byId = new Map(sources.map((s) => [s.id, s]));
  const see = seeOf(parsed.see, byId);

  if (parsed.answerable !== true)
    return {
      answer: { ...REFUSED, see },
      outcome: parsed.answerable === false ? 'refused' : 'unverified',
      dropped: 0,
    };

  const citations: KurzCitation[] = [];
  const numberOf = new Map<string, number>();
  const blocks: KurzAnswerBlock[] = [];
  let dropped = 0;
  const rawBlocks = Array.isArray(parsed.blocks) ? parsed.blocks : [];
  for (const raw of rawBlocks.slice(0, MAX_BLOCKS)) {
    if (!isRecord(raw)) {
      dropped++;
      continue;
    }
    const kind = raw.kind;
    const text = typeof raw.text === 'string' ? stripLinks(raw.text) : '';
    if (
      (kind !== 'claim' && kind !== 'example' && kind !== 'question') ||
      text === '' ||
      text.length > MAX_BLOCK_TEXT_CHARS
    ) {
      dropped++;
      continue;
    }
    if (kind === 'question') {
      if (!isShortQuestion(text) || blocks.some((b) => b.kind === 'question')) {
        dropped++;
        continue;
      }
      blocks.push({ kind, text: text.trim(), cites: [] });
      continue;
    }
    const cites: number[] = [];
    const rawCites = Array.isArray(raw.cites) ? raw.cites : [];
    for (const cite of rawCites.slice(0, MAX_CITES_PER_BLOCK)) {
      const valid = checkCite(cite, byId);
      if (!valid) {
        dropped++;
        continue;
      }
      const key = `${valid.source.id}:${valid.p}`;
      let n = numberOf.get(key);
      if (n === undefined) {
        n = citations.length + 1;
        numberOf.set(key, n);
        citations.push({
          n,
          source: valid.source.id,
          title: valid.source.title,
          route: valid.source.route,
          section: valid.section,
          p: valid.p,
          quote: valid.quote,
        });
      }
      if (!cites.includes(n)) cites.push(n);
    }
    if (cites.length === 0) {
      dropped++;
      continue;
    }
    blocks.push({ kind, text, cites });
  }

  if (!blocks.some((b) => b.kind !== 'question')) return unverified(dropped);

  const followUps = (Array.isArray(parsed.followUps) ? parsed.followUps : [])
    .filter(
      (f): f is string =>
        typeof f === 'string' &&
        f.trim() !== '' &&
        f.length <= MAX_FOLLOW_UP_CHARS,
    )
    .map((f) => stripLinks(f))
    .filter((f) => f !== '')
    .slice(0, MAX_FOLLOW_UPS);

  return {
    answer: { answerable: true, blocks, citations, see, followUps },
    outcome: 'answered',
    dropped,
  };
}

/** One question, not a paragraph that happens to end in "?": short, a single line, and a question mark at the end. */
function isShortQuestion(text: string): boolean {
  const t = text.trim();
  return (
    t.length <= MAX_QUESTION_BLOCK_CHARS &&
    !/[\r\n]/.test(t) &&
    /[?？]$/.test(t) &&
    (t.match(/[?？]/g) ?? []).length <= 2
  );
}

function checkCite(
  cite: unknown,
  byId: Map<string, KurzSource>,
): { source: KurzSource; p: number; quote: string; section: string } | null {
  if (!isRecord(cite)) return null;
  const { source: sourceId, p, quote } = cite;
  if (typeof sourceId !== 'string' || typeof quote !== 'string') return null;
  if (typeof p !== 'number' || !Number.isInteger(p)) return null;
  const source = byId.get(sourceId);
  const block = source?.blocks.find((b) => b.p === p);
  if (!source || !block || quote.length > MAX_QUOTE_CHARS) return null;
  const needle = normalizeForMatch(quote);
  if (needle.length < MIN_QUOTE_CHARS) return null;
  if (!normalizeForMatch(block.text).includes(needle)) return null;
  return { source, p, quote: quote.trim(), section: block.section };
}

/** `see` points at other posts only (never the one being read), each at most once, with our own title and route. */
function seeOf(raw: unknown, byId: Map<string, KurzSource>): KurzSee[] {
  const out: KurzSee[] = [];
  for (const id of Array.isArray(raw) ? raw : []) {
    const source = typeof id === 'string' ? byId.get(id) : undefined;
    if (!source || source.isPost || out.some((s) => s.source === source.id))
      continue;
    out.push({ source: source.id, title: source.title, route: source.route });
    if (out.length === MAX_SEE) break;
  }
  return out;
}
