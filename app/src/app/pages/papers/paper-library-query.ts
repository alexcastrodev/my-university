import { LIBRARY_STATUSES, LibraryQuery, LibrarySort } from '../../models/paper.model';

export const LIBRARY_SORTS: LibrarySort[] = ['added', 'title', 'completed', 'rating'];
const MAX_TEXT = 200;
const MAX_TAG = 40;

type Params = { get(name: string): string | null };

/** The library filters the URL carries; anything unknown or malformed is dropped rather than sent to the API. */
export function parseLibraryQuery(params: Params): LibraryQuery {
  const text = (name: string, max: number) => params.get(name)?.trim().slice(0, max) || undefined;
  const status = params.get('status');
  const sort = params.get('sort');
  const page = Number(params.get('page'));
  return {
    q: text('q', MAX_TEXT),
    status: LIBRARY_STATUSES.find((s) => s === status),
    tag: text('tag', MAX_TAG),
    sort: LIBRARY_SORTS.find((s) => s === sort),
    page: Number.isInteger(page) && page > 1 ? page : undefined,
  };
}

/** The query as URL parameters, without the keys that are not set. */
export function libraryQueryParams(query: LibraryQuery): Record<string, string | number> {
  return Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== ''));
}
