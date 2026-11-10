import { createHash } from 'node:crypto';

/** A DOI in its canonical form (lowercase, no resolver URL or `doi:` prefix), or null when invalid. */
export function normalizeDoi(raw: string): string | null {
  let doi = raw
    .trim()
    .toLowerCase()
    .replace(/^(https?:\/\/)?(dx\.)?doi\.org\//, '')
    .replace(/^doi:\s*/, '');
  try {
    doi = decodeURIComponent(doi);
  } catch {
    // Not percent-encoded after all; keep it as is.
  }
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : null;
}

/** Lowercase, no accents or punctuation, single spaces: the form two spellings of a text share. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Family name of "Given Family" or "Family, Given", normalized. */
export function familyName(author: string): string {
  const name = author.includes(',')
    ? author.split(',')[0]
    : (author.trim().split(/\s+/).pop() ?? '');
  return normalizeText(name);
}

/**
 * The identity of a paper that may have no DOI: normalized title, publication year and the first
 * author's family name. Two records with the same fingerprint are the same paper.
 */
export function paperFingerprint(
  title: string,
  publicationDate: string | null | undefined,
  firstAuthor: string | undefined,
): string {
  const key = [
    normalizeText(title),
    publicationDate?.slice(0, 4) ?? '',
    firstAuthor ? familyName(firstAuthor) : '',
  ].join('|');
  return createHash('sha256').update(key).digest('hex');
}
