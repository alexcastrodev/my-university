import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NavigationStart, Router } from '@angular/router';

export interface TextSelectionState {
  text: string;
  rect: DOMRect;
  isSelectAll: boolean;
}

const CONTENT_SELECTOR = '.concept-section, .section-body, .lesson-body';
const SELECT_ALL_COVERAGE_THRESHOLD = 0.9;
const DEBOUNCE_MS = 120;

@Injectable({ providedIn: 'root' })
export class TextSelectionService {
  private platformId = inject(PLATFORM_ID);
  private router = inject(Router);
  private isBrowser = isPlatformBrowser(this.platformId);

  selection = signal<TextSelectionState | null>(null);

  private selectAllIntent = false;
  private debounceHandle: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (!this.isBrowser) return;

    document.addEventListener('selectionchange', this.onSelectionChange, { passive: true });
    document.addEventListener('mouseup', this.onSelectionChange, { passive: true });
    document.addEventListener('keydown', this.onKeyDown, { passive: true });

    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) this.clear();
    });
  }

  clear(): void {
    this.selectAllIntent = false;
    this.selection.set(null);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'a') return;
    if (this.closestContent(event.target as Node)) this.selectAllIntent = true;
  };

  private onSelectionChange = (): void => {
    if (this.debounceHandle) clearTimeout(this.debounceHandle);
    this.debounceHandle = setTimeout(() => this.evaluateSelection(), DEBOUNCE_MS);
  };

  private evaluateSelection(): void {
    const sel = document.getSelection();
    const text = sel?.toString().trim() ?? '';

    if (!sel || sel.rangeCount === 0 || !text) {
      this.clear();
      return;
    }

    const range = sel.getRangeAt(0);
    const container = this.closestContent(range.commonAncestorContainer);
    if (!container) {
      this.clear();
      return;
    }

    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      this.clear();
      return;
    }

    const containerLength = container.textContent?.trim().length || 1;
    const coverage = text.length / containerLength;
    const isSelectAll = this.selectAllIntent || coverage >= SELECT_ALL_COVERAGE_THRESHOLD;

    this.selection.set({ text, rect, isSelectAll });
    this.selectAllIntent = false;
  }

  private closestContent(node: Node | null): Element | null {
    if (!node) return null;
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    return el?.closest(CONTENT_SELECTOR) ?? null;
  }
}
