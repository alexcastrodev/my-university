import { PAPER_TYPES, PaperQuery, PaperSort } from '../../models/paper.model';

const SORTS: PaperSort[] = ['recent', 'title'];
const MAX_TEXT = 200;

type Params = { get(name: string): string | null };

/** The catalog filters the URL carries; anything unknown or malformed is dropped rather than sent to the API. */
export function parsePaperQuery(params: Params): PaperQuery {
  const text = (name: string) => params.get(name)?.trim().slice(0, MAX_TEXT) || undefined;
  const type = params.get('type');
  const sort = params.get('sort');
  const page = Number(params.get('page'));
  return {
    q: text('q'),
    author: text('author'),
    keyword: text('keyword'),
    area: text('area'),
    type: PAPER_TYPES.find((t) => t === type),
    sort: SORTS.find((s) => s === sort),
    page: Number.isInteger(page) && page > 1 ? page : undefined,
  };
}

/** The query as URL parameters, without the keys that are not set. */
export function paperQueryParams(query: PaperQuery): Record<string, string | number> {
  return Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== ''));
}
