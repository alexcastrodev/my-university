/** One card of the mobile feed (`GET /api/feed`): a concept from any area, read in one screen. */
export interface FeedItem {
  module: string;
  /** Only set for Computer Science concepts, addressed by module + discipline + slug. */
  discipline?: string;
  slug: string;
  title: string;
  summary: string;
  /** First real source snippet of the concept, cut to a few lines. */
  code?: { lang: string; source: string };
  route: string[];
  read: boolean;
}

export interface FeedPage {
  items: FeedItem[];
  total: number;
  nextOffset: number | null;
  /** Concepts marked "Got it" since the start of the current UTC day. */
  gotItToday: number;
}

/** Chip filters, matching `FEED_AREAS` on the backend. */
export type FeedArea =
  | 'all'
  | 'java'
  | 'spring'
  | 'quarkus'
  | 'databases'
  | 'system-design'
  | 'kubernetes'
  | 'algorithms'
  | 'ruby'
  | 'cs';
