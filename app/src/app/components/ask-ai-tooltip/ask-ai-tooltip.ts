import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  PLATFORM_ID,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { TextSelectionService } from '../../services/text-selection';
import { buildAskAiPrompt } from '../../shared/ask-ai-prompt';

const GAP = 8;
const VIEWPORT_PADDING = 8;
const ESTIMATED_WIDTH = 280;
const ESTIMATED_HEIGHT = 44;
const PIN_MS = 2500;

type AskAiStatus = { kind: 'copied' } | { kind: 'copy-failed' } | null;

@Component({
  selector: 'app-ask-ai-tooltip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ask-ai-tooltip.html',
  styleUrl: './ask-ai-tooltip.css',
})
export class AskAiTooltip {
  private platformId = inject(PLATFORM_ID);
  private selectionService = inject(TextSelectionService);
  private isBrowser = isPlatformBrowser(this.platformId);
  private isTouch = this.isBrowser && window.matchMedia('(pointer: coarse)').matches;

  private host = viewChild<ElementRef<HTMLElement>>('tooltip');
  private pinned = signal(false);
  private pinTimer: ReturnType<typeof setTimeout> | null = null;

  selection = this.selectionService.selection;
  status = signal<AskAiStatus>(null);
  visible = computed(() => this.selection() !== null || this.pinned());

  style = computed(() => {
    const sel = this.selection();
    if (!sel || !this.isBrowser) return {};

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const spaceAbove = sel.rect.top;
    const placeBelow = this.isTouch || spaceAbove < ESTIMATED_HEIGHT + GAP + VIEWPORT_PADDING;

    let top = placeBelow ? sel.rect.bottom + GAP : sel.rect.top - ESTIMATED_HEIGHT - GAP;
    top = Math.max(VIEWPORT_PADDING, Math.min(top, vh - ESTIMATED_HEIGHT - VIEWPORT_PADDING));

    let left = sel.rect.left + sel.rect.width / 2 - ESTIMATED_WIDTH / 2;
    left = Math.max(VIEWPORT_PADDING, Math.min(left, vw - ESTIMATED_WIDTH - VIEWPORT_PADDING));

    return { top: `${top}px`, left: `${left}px` };
  });

  constructor() {
    if (!this.isBrowser) return;

    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('mousedown', this.onDocumentMouseDown, { capture: true });
    window.addEventListener('scroll', this.onScroll, { passive: true, capture: true });
  }

  async ask(target: 'claude' | 'chatgpt'): Promise<void> {
    const sel = this.selection();
    if (!sel) return;

    const prompt = buildAskAiPrompt(sel.text, sel.isSelectAll, window.location.href);
    const url = target === 'claude' ? prompt.claudeUrl : prompt.chatGptUrl;

    if (prompt.mode === 'clipboard') {
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

  private pin(): void {
    this.pinned.set(true);
    if (this.pinTimer) clearTimeout(this.pinTimer);
    this.pinTimer = setTimeout(() => this.close(), PIN_MS);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.close();
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
    this.status.set(null);
    this.selectionService.clear();
  }
}
