import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { Location, isPlatformBrowser } from '@angular/common';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { CONTENT_SELECTOR } from './text-selection';
import {
  HighlightParams,
  buildHighlightParams,
  buildHighlightUrl,
  computeHighlightOffsets,
  findHighlightRange,
  readHighlightParams,
} from '../shared/text-highlight';

const HIGHLIGHT_NAME = 'shared-highlight';
/** Concept content is fetched after navigation, so keep looking for a while. */
const WAIT_FOR_CONTENT_MS = 15000;

/**
 * Applies the highlight carried in the URL (`?hl=`) once the page content is
 * rendered, and builds those links from the reader's current selection.
 */
@Injectable({ providedIn: 'root' })
export class TextHighlightService {
  private platformId = inject(PLATFORM_ID);
  private router = inject(Router);
  private location = inject(Location);
  private isBrowser = isPlatformBrowser(this.platformId);

  private observer: MutationObserver | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (!this.isBrowser) return;

    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) this.reset();
      if (event instanceof NavigationEnd) this.applyFromUrl();
    });
  }

  /**
   * Writes the selection into the address bar, highlights it in place and
   * returns the shareable URL (null when the selection can't be encoded).
   */
  shareSelection(selectedText: string, range?: Range): string | null {
    return this.applySelection(selectedText, range, true);
  }

  /** Same as `shareSelection` but keeps the native selection, so it can run while the reader selects. */
  previewSelection(selectedText: string, range?: Range): void {
    this.applySelection(selectedText, range, false);
  }

  private applySelection(selectedText: string, range: Range | undefined, clearSelection: boolean): string | null {
    const params = buildHighlightParams(selectedText);
    if (!params) return null;
    if (range) Object.assign(params, computeHighlightOffsets(this.contentRoots(), range));

    const url = buildHighlightUrl(window.location.href, params);
    const query = new URL(url).searchParams.toString();
    const [path] = this.location.path().split(/[?#]/);
    this.location.replaceState(path, query);

    this.reset();
    if (clearSelection) window.getSelection()?.removeAllRanges();
    this.tryApply(params, false, !clearSelection);
    return url;
  }

  private applyFromUrl(): void {
    const params = readHighlightParams(window.location.search);
    if (!params) return;
    if (this.tryApply(params, true)) return;

    this.observer = new MutationObserver(() => {
      if (this.tryApply(params, true)) this.stopWaiting();
    });
    this.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    this.timeout = setTimeout(() => this.stopWaiting(), WAIT_FOR_CONTENT_MS);
  }

  private tryApply(params: HighlightParams, scroll: boolean, keepSelection = false): boolean {
    const roots = this.contentRoots();
    if (roots.length === 0) return false;

    const range = findHighlightRange(roots, params);
    if (!range) return false;

    if (typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined') {
      CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(range));
    } else if (!keepSelection) {
      // Older browsers: fall back to the native selection so the passage still stands out.
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }

    if (scroll) {
      const target = range.startContainer.parentElement;
      // Let the router's scroll restoration run first, then bring the passage into view.
      requestAnimationFrame(() => target?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }
    return true;
  }

  private contentRoots(): Element[] {
    return Array.from(document.querySelectorAll(CONTENT_SELECTOR)).filter(
      (el) => !el.parentElement?.closest(CONTENT_SELECTOR),
    );
  }

  private stopWaiting(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = null;
  }

  private reset(): void {
    this.stopWaiting();
    if (typeof CSS !== 'undefined' && 'highlights' in CSS) CSS.highlights.delete(HIGHLIGHT_NAME);
  }
}
