import { ReviewSourceType } from './review.model';

/**
 * Daily session — the mixed 4-card experience from the mobile mockups
 * (tmp/mobile/): Recall → Read → Notice → Write, framed as
 * "Four cards. About five minutes."
 *
 * This is the presentation contract the UI renders against. It is produced by
 * `GET /api/daily/session` (`DailyService`, tasks.md · grupo F) from the user's
 * real due reviews and read history — never fabricated. A session can
 * legitimately have fewer than 4 cards (e.g. nothing due, or too little read
 * history yet) or even zero (brand-new user); components must render that
 * honestly instead of assuming exactly 4.
 *
 * Recall is self-rating, not real multiple choice: there is no distractor
 * (wrong-answer) data anywhere in the platform, and authoring it for every
 * concept was out of scope — so Recall reuses the same binary the spaced-
 * repetition review queue already has ("I remember" / "I do not remember"),
 * posted as SM2 ratings `good`/`again` via `sourceType`/`sourceId` below.
 */

export type DailyCardType = 'recall' | 'read' | 'notice' | 'write';

interface DailyCardCommon {
  type: DailyCardType;
  /** XP awarded for this card, e.g. 20. */
  xp: number;
  /** Short title in the "Today" preview list. */
  previewTitle: string;
  /** Secondary line in the "Today" preview list, e.g. "Marked in March · Java Concepts". */
  previewSubtitle: string;
  /** One-line recap shown on the session-done screen, e.g. "Recall · reference reachability". */
  recap: string;
  /** In-session eyebrow, e.g. "RECALL · NO LOOKING BACK". */
  kicker: string;
  /** In-session heading or question. */
  title: string;
}

export interface RecallCard extends DailyCardCommon {
  type: 'recall';
  context?: string;
  /** Kept for a possible future real-MCQ source; nothing produces these today (see file header). */
  options?: string[];
  correctIndex?: number;
  /** Shown after "I do not remember" — reassurance, not punishment. */
  wrongNote?: string;
  /** Identity posted to `POST /api/review/answer` (via `/api/daily/complete`) when rated. */
  sourceType: ReviewSourceType;
  sourceId: string;
  /** "Open the full topic" link, shown on "I do not remember". */
  route?: string[];
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
}

export interface NoticeCard extends DailyCardCommon {
  type: 'notice';
  code: CodeBlock;
  lead?: string;
  takeawayLabel?: string;
  takeaway?: string;
  /** Identity posted to `/api/daily/complete` for the XP grant. */
  sourceId: string;
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

export type DailyCard = RecallCard | ReadCard | NoticeCard | WriteCard;

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
