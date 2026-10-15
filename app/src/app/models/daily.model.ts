/**
 * Daily session: the mixed card experience from the mobile mockups
 * (tmp/mobile/): Read → Notice → Write.
 *
 * This is the presentation contract the UI renders against. It is produced by
 * `GET /api/daily/session` (`DailyService`) from the user's real read history,
 * never fabricated. A session can legitimately have fewer than 3 cards (too
 * little read history yet) or even zero (brand-new user); components must
 * render that honestly instead of assuming exactly 3.
 */

export type DailyCardType = 'read' | 'notice' | 'write';

interface DailyCardCommon {
  type: DailyCardType;
  /** XP awarded for this card, e.g. 20. */
  xp: number;
  /** Short title in the "Today" preview list. */
  previewTitle: string;
  /** Secondary line in the "Today" preview list, e.g. "Marked in March · Java Concepts". */
  previewSubtitle: string;
  /** One-line recap shown on the session-done screen, e.g. "Read · WeakHashMap internals". */
  recap: string;
  /** In-session eyebrow, e.g. "READ · ONE SCREEN". */
  kicker: string;
  /** In-session heading or question. */
  title: string;
}

export interface CodeBlock {
  /** Header label, e.g. "JAVA" or "JAVA.UTIL.WEAKHASHMAP". */
  header: string;
  /** Optional right-aligned badge, e.g. "JDK 21". */
  badge?: string;
  source: string;
}

export interface ReadCard extends DailyCardCommon {
  type: 'read';
  breadcrumb?: string;
  /** One screen of prose. Paragraphs split on blank lines. */
  body: string;
  code?: CodeBlock;
  note?: string;
  fullTopicRoute?: string[];
  /** Identity posted to `/api/daily/complete` for the XP grant. */
  sourceId: string;
  module?: string;
}

export interface NoticeCard extends DailyCardCommon {
  type: 'notice';
  code: CodeBlock;
  lead?: string;
  takeawayLabel?: string;
  takeaway?: string;
  /** Identity posted to `/api/daily/complete` for the XP grant. */
  sourceId: string;
  module?: string;
}

export interface WriteCard extends DailyCardCommon {
  type: 'write';
  placeholderHint?: string;
  maxLength: number;
  pastAnswer?: { when: string; text: string; note?: string };
  /** Closing note under the editor, e.g. the "renews for six months" line. */
  footnote?: string;
  /** Identity posted to `/api/daily/complete` (with the written text) for persistence + XP. */
  sourceId: string;
}

export type DailyCard = ReadCard | NoticeCard | WriteCard;

export interface DailySessionSummary {
  /** Headline on the session-done screen. */
  headline: string;
  tomorrow: { title: string; body: string };
}

export interface DailySession {
  estimatedMinutes: number;
  cards: DailyCard[];
  summary: DailySessionSummary;
}
