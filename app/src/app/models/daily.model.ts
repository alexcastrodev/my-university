/**
 * Daily session — the mixed 4-card experience from the mobile mockups
 * (tmp/mobile/): Recall → Read → Notice → Write, framed as
 * "Four cards. About five minutes."
 *
 * This is the presentation contract the UI renders against. For now it is
 * produced client-side by DailySessionService; the seam is deliberately
 * shaped so a backend "session builder" endpoint (see tasks.md · grupo F)
 * can return the same shape later without touching the components.
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
  options: string[];
  correctIndex: number;
  /** Shown after a wrong answer — reassurance, not punishment. */
  wrongNote?: string;
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
}

export interface NoticeCard extends DailyCardCommon {
  type: 'notice';
  code: CodeBlock;
  lead?: string;
  takeawayLabel?: string;
  takeaway: string;
}

export interface WriteCard extends DailyCardCommon {
  type: 'write';
  placeholderHint?: string;
  maxLength: number;
  pastAnswer?: { when: string; text: string; note?: string };
  /** Closing note under the editor, e.g. the "renews for six months" line. */
  footnote?: string;
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
