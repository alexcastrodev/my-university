import { Injectable, signal } from '@angular/core';

export type ConceptCardViewMode = 'grid' | 'list';

const VIEW_MODE_STORAGE_KEY = 'concept-card-view-mode';

/**
 * List is the default: most concept lists now carry a real prerequisite order
 * (`sortByPrerequisites` on the backend), and a numbered, connected sequence is what
 * actually communicates "read these in this order" — a multi-column grid doesn't.
 * Grid stays available from the toggle for anyone who prefers to browse instead.
 */
function readStoredViewMode(): ConceptCardViewMode {
  if (typeof localStorage === 'undefined') return 'list';
  return localStorage.getItem(VIEW_MODE_STORAGE_KEY) === 'grid' ? 'grid' : 'list';
}

/** Shared grid/list view preference for every concept list page — one toggle, applied everywhere. */
@Injectable({ providedIn: 'root' })
export class ConceptViewModeService {
  readonly mode = signal<ConceptCardViewMode>(readStoredViewMode());

  setMode(mode: ConceptCardViewMode) {
    this.mode.set(mode);
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
  }
}
