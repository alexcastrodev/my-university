export type SearchResultType =
  | 'course'
  | 'lesson'
  | 'java-minute'
  | 'java-concept'
  | 'jvm-concept'
  | 'curriculum-concept'
  | 'database-concept'
  | 'spring-concept'
  | 'system-design-concept'
  | 'testing-concept'
  | 'algorithms-concept'
  | 'ruby-concept'
  | 'rubyonrails-concept'
  | 'quarkus-concept'
  | 'kubernetes-concept'
  | 'dotnet-concept'
  | 'csharp-concept';

export interface SearchResult {
  type: SearchResultType;
  title: string;
  subtitle: string | null;
  url: string;
  /** Title with matches wrapped in HIGHLIGHT_START/HIGHLIGHT_END. */
  highlightedTitle: string;
  /** Body excerpt around the best match, highlighted the same way; null when only the title matched. */
  snippet: string | null;
  /** Language of the version that matched: a page without a translation matches in English. */
  language: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  total: number;
  /** Hits per type for the query, regardless of the active type filter. */
  facets: Partial<Record<SearchResultType, number>>;
}

/** Private-use code points the API wraps matches in (see backend search.service.ts). */
export const HIGHLIGHT_START = '\uE000';
export const HIGHLIGHT_END = '\uE001';

export interface HighlightSegment {
  text: string;
  match: boolean;
}

/** Splits a highlighted string into plain and matched runs, so the template renders them as text (never as HTML). */
export function toHighlightSegments(value: string): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  for (const [i, part] of value.split(HIGHLIGHT_START).entries()) {
    if (i === 0) {
      if (part) segments.push({ text: part, match: false });
      continue;
    }
    const end = part.indexOf(HIGHLIGHT_END);
    if (end === -1) {
      if (part) segments.push({ text: part, match: false });
      continue;
    }
    if (end > 0) segments.push({ text: part.slice(0, end), match: true });
    const rest = part.slice(end + HIGHLIGHT_END.length);
    if (rest) segments.push({ text: rest, match: false });
  }
  return segments;
}
