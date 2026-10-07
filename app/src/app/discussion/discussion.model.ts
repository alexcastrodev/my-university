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

/** A paragraph (or code block) of the page that can carry a discussion. */
export interface BlockAnchor {
  key: string;
  index: number;
  quote: string;
}

/** What the discussion panel is showing: an existing marker, a block waiting for its first comment, or both. */
export interface PanelTarget {
  markerId: number | null;
  block: BlockAnchor | null;
  quote: string;
  /** Scroll the paragraph into view (opened from the list, not by clicking it). */
  reveal: boolean;
}
