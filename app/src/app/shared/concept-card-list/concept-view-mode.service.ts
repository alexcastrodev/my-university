import { Injectable, signal } from '@angular/core';

export type ConceptCardViewMode = 'grid' | 'list';

const VIEW_MODE_STORAGE_KEY = 'concept-card-view-mode';

function readStoredViewMode(): ConceptCardViewMode {
  if (typeof localStorage === 'undefined') return 'grid';
  return localStorage.getItem(VIEW_MODE_STORAGE_KEY) === 'list' ? 'list' : 'grid';
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
