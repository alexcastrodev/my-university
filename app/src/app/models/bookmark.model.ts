/** What the reader was looking at: the concept itself or its Lab tab. */
export type BookmarkTab = 'concept' | 'lab';

/** A concept as the API names it: module and slug, plus the discipline for Computer Science. */
export interface ConceptTarget {
  module: string;
  slug: string;
  discipline?: string;
}

/** The reader's place in one module (a track, or a Computer Science discipline). */
export interface Bookmark extends ConceptTarget {
  id: string;
  scope: string;
  title: string;
  route: string[];
  tab: BookmarkTab;
  updatedAt: string;
}

export interface BookmarksState {
  /** One per module, newest first. */
  bookmarks: Bookmark[];
  /** The concepts whose lab the reader said they finished. */
  labDone: ConceptTarget[];
}
