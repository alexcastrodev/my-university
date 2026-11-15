/** Mirrors the /api/kurz responses (backend/src/kurz). */

export type KurzBlockKind = 'claim' | 'example';

export interface KurzCitation {
  n: number;
  /** `S1` is the post the student is on; the others are posts it links as related. */
  source: string;
  title: string;
  route: string[];
  section: string;
  p: number;
  /** Literal text of the cited block of the post, what the page looks for to scroll to and highlight. */
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

export type KurzStoredOutcome = 'answered' | 'refused' | 'unverified' | 'incomplete';

export interface KurzMessage {
  id: string;
  question: string;
  outcome: KurzStoredOutcome;
  answer: KurzAnswer;
  helpful: boolean | null;
  createdAt: string;
}

export interface KurzConversation {
  id: string;
  anchorKey: string | null;
  blockIndex: number | null;
  selection: string | null;
  /** The post changed since this was asked: its paragraphs may not be where they were. */
  stale: boolean;
  updatedAt: string;
  messages: KurzMessage[];
}

export type KurzBlockReason =
  'PLATFORM_BUDGET_MONTHLY' | 'PLATFORM_BUDGET_DAILY' | 'USER_DAILY_LIMIT' | 'NO_BALANCE';

export interface KurzStatus {
  enabled: boolean;
  termsVersion: string;
  /** The notice is shown the first time they try the Kurz with credit. */
  termsRequired: boolean;
  balance: number;
  dailyLimit: number;
  usedLast24h: number;
  platformBudget: { period: 'day' | 'month'; usedPercent: number; resetsAt: string };
  blocked: { reason: KurzBlockReason; resetsAt: string | null } | null;
}

export interface KurzAskResult {
  conversationId: string;
  message: KurzMessage;
  credits: number;
  balance: number;
}

/** What went wrong with a question, in the terms the screen speaks. `resetsAt` says when it works again. */
export type KurzErrorKind =
  | 'signIn'
  | 'noAccess'
  | 'terms'
  | 'disabled'
  | 'unavailable'
  | 'blocked'
  | 'rateLimited'
  | 'inProgress'
  | 'upstream'
  | 'timeout'
  | 'failed'
  | KurzBlockReason;

export interface KurzError {
  kind: KurzErrorKind;
  resetsAt: string | null;
}

/** Where the student asked from. A paragraph, a selection in it, or (both null) the whole post. */
export interface KurzScope {
  anchorKey: string | null;
  blockIndex: number | null;
  selection: string | null;
}

export const KURZ_MAX_QUESTION = 500;
export const KURZ_MAX_SELECTION = 2000;
