/** Mirrors the /api/discussions responses. */
export interface DiscussionTopic {
  module: string;
  slug: string;
  discipline?: string;
  lang: string;
}

export interface MarkerSummary {
  id: number;
  anchorKey: string;
  blockIndex: number;
  quote: string;
  commentCount: number;
  resolvedCount: number;
}

export interface CommentView {
  id: number;
  body: string;
  deleted: boolean;
  author: { id: number; displayName: string; avatarUrl: string } | null;
  createdAt: string;
  editedAt: string | null;
  votes: number;
  votedByMe: boolean;
  mine: boolean;
  /** Handles in the body that are a public profile: only these render as links. */
  mentions?: string[];
}

export interface ThreadView {
  root: CommentView;
  replies: CommentView[];
  resolved: boolean;
  acceptedReplyId: number | null;
}

export interface MarkerDetail {
  id: number;
  quote: string;
  commentCount: number;
  threads: ThreadView[];
}

/** Every discussion, the ones the reader opened, or any they commented on. */
export type FeedScope = 'all' | 'mine' | 'participated';

/** One marker of the /api/discussions/feed list. `area` is the concept's module. */
export interface FeedItem {
  markerId: number;
  area: string;
  conceptTitle: string;
  slug: string;
  route: string[];
  lang: string;
  quote: string;
  commentCount: number;
  resolvedCount: number;
  lastActivityAt: string;
  startedByMe: boolean;
  participatedByMe: boolean;
}

export interface FeedPage {
  items: FeedItem[];
  nextCursor: string | null;
}

export interface FeedArea {
  area: string;
  count: number;
}

/** A paragraph (or code block) of the page that can carry a discussion. */
export interface BlockAnchor {
  key: string;
  index: number;
  quote: string;
}

/** The two tabs of the panel: the private conversation with the Kurz, and the public discussion. */
export type PanelTab = 'kurz' | 'discussion';

/**
 * What the panel is showing: an existing marker, a block waiting for its first comment, or both. With no
 * marker and no block it is the whole post (the Kurz's floating button), which has no paragraph discussion.
 */
export interface PanelTarget {
  markerId: number | null;
  block: BlockAnchor | null;
  quote: string;
  /** Scroll the paragraph into view (opened from the list, not by clicking it). */
  reveal: boolean;
  /** What the reader selected to ask the Kurz about: it opens the conversation with it as the passage. */
  selection?: string | null;
}
