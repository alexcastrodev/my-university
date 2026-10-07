import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { isPhoneViewport } from '../shared/breakpoints';
import { Block, collectBlocks, matchMarkers } from './block-anchor';
import { DiscussionEntry, DiscussionPanel } from './discussion-panel';
import { DiscussionService } from './discussion.service';

/** Content that has its own click behavior; a click there must not open a discussion. */
const INTERACTIVE =
  'a, button, summary, input, textarea, .deep-dive-trigger, .mermaid-diagram, .concept-viz';
const RESCAN_DELAY_MS = 150;

const FLAG_ICON =
  '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 3h2v18H5zM8 4h11l-3 4 3 4H8z"/></svg>';
const CHECK_ICON =
  '<svg class="dz-check" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';

/**
 * Bridges the concept page and the discussion feature. It finds the paragraphs inside the page
 * content (which arrives late and is replaced on navigation), draws a marker on each, opens the
 * discussion when one is clicked, and hosts the panel. The markers are buttons with no text of
 * their own (the count is drawn by CSS), so they never change the text a paragraph is hashed from.
 */
@Component({
  selector: 'app-discussion-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DiscussionPanel],
  template: `
    @if (discussion.panelOpen()) {
      <app-discussion-panel [entries]="entries()" />
    }
  `,
})
export class DiscussionHost implements OnDestroy {
  /** The element whose descendants are scanned for paragraphs. */
  content = input.required<HTMLElement>();

  protected discussion = inject(DiscussionService);
  private router = inject(Router);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private blocks = signal<Block[]>([]);
  private match = computed(() => matchMarkers(this.blocks(), this.discussion.markers()));

  protected entries = computed<DiscussionEntry[]>(() => {
    const { byBlock } = this.match();
    const blockOf = new Map<number, Block>();
    for (const [index, marker] of byBlock) {
      const block = this.blocks().find((b) => b.index === index);
      if (block) blockOf.set(marker.id, block);
    }
    return this.discussion.markers().map((marker) => ({ marker, block: blockOf.get(marker.id) ?? null }));
  });

  private observer: MutationObserver | null = null;
  private attached: HTMLElement | null = null;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private revealed: unknown = null;

  constructor() {
    if (!this.isBrowser) return;

    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.discussion.syncTopic(e.urlAfterRedirects));
    if (this.router.navigated && !this.router.getCurrentNavigation()) {
      this.discussion.syncTopic(this.router.url);
    }
    document.addEventListener('click', this.onDocumentClick);

    effect(() => {
      const content = this.content();
      untracked(() => this.attach(content));
    });
    effect(() => {
      this.entries();
      this.discussion.markersVisible();
      this.discussion.target();
      untracked(() => this.render());
    });
    effect(() => {
      const target = this.discussion.target();
      if (!target || target.block || target.markerId === null) return;
      const entry = this.entries().find((e) => e.marker.id === target.markerId);
      if (entry?.block) untracked(() => this.discussion.attachBlock(entry.block!));
    });
    effect((onCleanup) => {
      // The sheet covers the page on phones, so the page behind it must not scroll.
      if (!this.discussion.panelOpen() || !isPhoneViewport()) return;
      const previous = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      onCleanup(() => (document.body.style.overflow = previous));
    });
  }

  ngOnDestroy(): void {
    if (!this.isBrowser) return;
    this.observer?.disconnect();
    this.attached?.removeEventListener('click', this.onContentClick);
    document.removeEventListener('click', this.onDocumentClick);
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.discussion.reset();
  }

  private attach(content: HTMLElement): void {
    if (this.attached === content) return;
    this.observer?.disconnect();
    this.attached?.removeEventListener('click', this.onContentClick);

    this.attached = content;
    content.addEventListener('click', this.onContentClick);
    this.observer = new MutationObserver(() => this.scheduleScan());
    this.observer.observe(content, { childList: true, subtree: true });
    this.scheduleScan();
  }

  private scheduleScan(): void {
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.scanTimer = setTimeout(() => this.scan(), RESCAN_DELAY_MS);
  }

  private scan(): void {
    const content = this.attached;
    if (!content) return;
    const next = collectBlocks(content);
    const previous = this.blocks();
    // Drawing markers is a DOM change too, and lands here; only react to real content changes.
    const same =
      next.length === previous.length &&
      next.every((b, i) => b.el === previous[i].el && b.key === previous[i].key);
    if (!same) this.blocks.set(next);
  }

  private render(): void {
    const on = this.discussion.markersVisible();
    const { byBlock } = this.match();
    const target = this.discussion.target();
    let activeEl: HTMLElement | null = null;

    for (const block of this.blocks()) {
      const el = block.el;
      el.classList.add('dz-block');
      let button = el.querySelector<HTMLButtonElement>(':scope > .dz-marker');
      if (!on) {
        button?.remove();
        el.classList.remove('dz-active');
        continue;
      }

      const marker = byBlock.get(block.index) ?? null;
      const active =
        !!target &&
        (target.markerId !== null
          ? marker?.id === target.markerId
          : target.block?.index === block.index);
      if (active) activeEl = el;

      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'dz-marker';
        el.appendChild(button);
      }
      button.classList.toggle('is-empty', !marker);
      button.classList.toggle('is-active', active);
      button.dataset['count'] = marker ? String(marker.commentCount) : '+';
      button.setAttribute(
        'aria-label',
        marker
          ? $localize`:@@discussion.markerAria:Discussion, ${marker.commentCount}:count: comments`
          : $localize`:@@discussion.newMarkerAria:Start a discussion on this paragraph`,
      );
      const resolved = (marker?.resolvedCount ?? 0) > 0;
      if (button.dataset['resolved'] !== String(resolved)) {
        button.dataset['resolved'] = String(resolved);
        button.innerHTML = FLAG_ICON + (resolved ? CHECK_ICON : '');
      }
      el.classList.toggle('dz-active', active);
    }

    if (target?.reveal && activeEl && this.revealed !== target) {
      this.revealed = target;
      (activeEl as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  private onContentClick = (event: MouseEvent): void => {
    if (!this.discussion.markersVisible()) return;
    const target = event.target as Element | null;
    if (!target) return;

    const onMarker = !!target.closest('.dz-marker');
    if (!onMarker) {
      if (target.closest(INTERACTIVE)) return;
      // Selecting text to copy or share must not pop a panel open.
      if (window.getSelection()?.isCollapsed === false) return;
    }

    const el = target.closest<HTMLElement>('.dz-block');
    const block = el && this.blocks().find((b) => b.el === el);
    if (!block) return;

    const marker = this.match().byBlock.get(block.index) ?? null;
    const open = this.discussion.target();
    const alreadyOpen =
      !!open && (marker ? open.markerId === marker.id : open.block?.index === block.index);
    if (alreadyOpen) this.discussion.close();
    else this.discussion.openBlock(block, marker);
  };

  /** A Deep Dive panel opens in the same slot, so opening one gives way to it. */
  private onDocumentClick = (event: MouseEvent): void => {
    if (!this.discussion.panelOpen()) return;
    if ((event.target as Element | null)?.closest('.deep-dive-trigger')) this.discussion.close();
  };
}
