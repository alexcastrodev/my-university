import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { DiscussionService } from '../../discussion/discussion.service';
import { KurzAvatar } from '../../kurz/kurz-avatar';
import { KurzService } from '../../kurz/kurz.service';
import { isPhoneViewport } from '../../shared/breakpoints';
import { KURZ_MAX_SELECTION } from '../../kurz/kurz.model';
import { TextSelectionService } from '../../services/text-selection';
import { TextHighlightService } from '../../services/text-highlight.service';
import { AskAiTarget, buildAskAiPrompt } from '../../shared/ask-ai-prompt';

const GAP = 8;
const VIEWPORT_PADDING = 8;
/** The menu on desktop is a short column; on phones it is one bar (its "open in" row drops under it). */
const SIZE = { column: { width: 300, height: 140 }, bar: { width: 260, height: 56 } };
const PIN_MS = 2500;

type AskAiStatus =
  | { kind: 'copied' }
  | { kind: 'copy-failed' }
  | { kind: 'link-copied' }
  | { kind: 'link-copy-failed' }
  | null;

@Component({
  selector: 'app-ask-ai-tooltip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [KurzAvatar],
  templateUrl: './ask-ai-tooltip.html',
  styleUrl: './ask-ai-tooltip.css',
})
export class AskAiTooltip {
  private platformId = inject(PLATFORM_ID);
  private selectionService = inject(TextSelectionService);
  private highlightService = inject(TextHighlightService);
  private discussion = inject(DiscussionService);
  private kurz = inject(KurzService);
  private isBrowser = isPlatformBrowser(this.platformId);
  private isTouch = this.isBrowser && window.matchMedia('(pointer: coarse)').matches;
  /** A phone, or a touch screen: the menu is a bar under the selection, with 44px targets. */
  protected compact = this.isTouch || isPhoneViewport();
  protected moreOpen = signal(false);

  private host = viewChild<ElementRef<HTMLElement>>('tooltip');
  private pinned = signal(false);
  private pinTimer: ReturnType<typeof setTimeout> | null = null;

  selection = this.selectionService.selection;
  status = signal<AskAiStatus>(null);
  /** The panel covers the page it answers about, so the menu steps aside while it is open. */
  visible = computed(
    () => (this.selection() !== null || this.pinned()) && !this.discussion.panelOpen(),
  );
  /** Only on a post (a page with a topic) and while the Kurz is on. */
  kurzAvailable = computed(() => this.discussion.available() && this.kurz.enabled());

  style = computed(() => {
    const sel = this.selection();
    if (!sel || !this.isBrowser) return {};

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const { width, height } = this.compact ? SIZE.bar : SIZE.column;
    const spaceAbove = sel.rect.top;
    const placeBelow = this.isTouch || spaceAbove < height + GAP + VIEWPORT_PADDING;

    let top = placeBelow ? sel.rect.bottom + GAP : sel.rect.top - height - GAP;
    top = Math.max(VIEWPORT_PADDING, Math.min(top, vh - height - VIEWPORT_PADDING));

    let left = sel.rect.left + sel.rect.width / 2 - width / 2;
    left = Math.max(VIEWPORT_PADDING, Math.min(left, vw - width - VIEWPORT_PADDING));

    return { top: `${top}px`, left: `${left}px` };
  });

  constructor() {
    if (!this.isBrowser) return;

    // Highlight as soon as text is selected, without waiting for the copy-link click.
    effect(() => {
      const sel = this.selection();
      if (sel) this.highlightService.previewSelection(sel.text, sel.range);
    });

    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('mousedown', this.onDocumentMouseDown, { capture: true });
    window.addEventListener('scroll', this.onScroll, { passive: true, capture: true });
  }

  async ask(target: AskAiTarget): Promise<void> {
    const sel = this.selection();
    if (!sel) return;

    const prompt = buildAskAiPrompt(sel.text, sel.isSelectAll, window.location.href);
    const url = prompt.urls[target];

    // Gemini doesn't officially document `?q=` prefill, so the prompt is also copied as a fallback.
    if (prompt.mode === 'clipboard' || target === 'gemini') {
      try {
        await navigator.clipboard.writeText(prompt.promptText);
        this.status.set({ kind: 'copied' });
      } catch {
        this.status.set({ kind: 'copy-failed' });
      }
      this.pin();
    }

    window.open(url, '_blank', 'noopener');
  }

  /** Opens the panel on the Kurz tab with the selection as the passage (a select-all asks about the whole post). */
  askKurz(): void {
    const sel = this.selection();
    if (!sel) return;
    if (sel.isSelectAll) this.discussion.openPost();
    else
      this.discussion.askKurzAbout(sel.range.startContainer, sel.text.slice(0, KURZ_MAX_SELECTION));
    this.close();
  }

  async copyHighlightLink(): Promise<void> {
    const sel = this.selection();
    if (!sel) return;

    const url = this.highlightService.shareSelection(sel.text, sel.range);
    if (!url) return;

    try {
      await navigator.clipboard.writeText(url);
      this.status.set({ kind: 'link-copied' });
    } catch {
      this.status.set({ kind: 'link-copy-failed' });
    }
    this.pin();
  }

  private pin(): void {
    this.pinned.set(true);
    if (this.pinTimer) clearTimeout(this.pinTimer);
    this.pinTimer = setTimeout(() => this.close(), PIN_MS);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.close();
    // Enter asks the Kurz, unless it was meant for something else (a field, a button, a link).
    if (event.key !== 'Enter' || !this.visible() || !this.selection() || !this.kurzAvailable())
      return;
    if (
      (event.target as Element | null)?.closest(
        'input, textarea, button, a, select, [contenteditable]',
      )
    )
      return;
    event.preventDefault();
    this.askKurz();
  };

  private onDocumentMouseDown = (event: MouseEvent): void => {
    if (!this.visible()) return;
    const hostEl = this.host()?.nativeElement;
    if (hostEl && !hostEl.contains(event.target as Node)) this.close();
  };

  private onScroll = (): void => {
    if (!this.pinned()) this.close();
  };

  private close(): void {
    this.pinned.set(false);
    this.moreOpen.set(false);
    this.status.set(null);
    this.selectionService.clear();
  }
}
