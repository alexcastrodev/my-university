/** One book on the shelf. `pages` sets the width of the spine; `cover` and `url` must be `https:` to be used. */
export interface ShelfBook {
  title: string;
  url?: string;
  pages: number;
  cover?: string;
}

/** The words the shelf shows, passed in so the app can translate them. */
export interface ShelfLabels {
  /** "616 pages" */
  pages(count: number): string;
  /** The accessible name of a book button: "Open Designing Data-Intensive Applications". */
  open(title: string): string;
}
