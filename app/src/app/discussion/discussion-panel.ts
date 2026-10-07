import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  LOCALE_ID,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { BlockAnchor, CommentView, MarkerSummary, ThreadView } from './discussion.model';
import { DiscussionService } from './discussion.service';

export interface DiscussionEntry {
  marker: MarkerSummary;
  block: BlockAnchor | null;
}

/** Swiping the sheet down by this much (px) closes it on phones. */
const SWIPE_CLOSE_PX = 80;
const MAX_BODY = 2000;

/**
 * The discussion of one paragraph: a side panel on desktop, a bottom sheet on phones. It only
 * talks to DiscussionService; finding paragraphs on the page is the host's job.
 */
@Component({
  selector: 'app-discussion-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, NgTemplateOutlet],
  templateUrl: './discussion-panel.html',
  styleUrl: './discussion-panel.css',
})
export class DiscussionPanel {
  protected discussion = inject(DiscussionService);
  private locale = inject(LOCALE_ID);

  /** Every discussed paragraph of the page, with where it sits now (null when its text changed). */
  entries = input<DiscussionEntry[]>([]);

  protected readonly maxBody = MAX_BODY;
  protected draft = signal('');
  protected replyingTo = signal<{ rootId: number; name: string } | null>(null);
  protected confirmingDelete = signal<number | null>(null);
  private swipeStart: number | null = null;

  protected target = this.discussion.target;
  protected threads = computed<ThreadView[]>(() => this.discussion.detail()?.threads ?? []);
  protected count = computed(() => this.discussion.detail()?.commentCount ?? 0);
  protected loading = computed(
    () => this.target()?.markerId != null && this.discussion.detail() === null,
  );

  /** Others that still have a paragraph to point at, and the ones whose text changed. */
  protected others = computed(() =>
    this.entries().filter((e) => e.block && e.marker.id !== this.target()?.markerId),
  );
  protected changed = computed(() =>
    this.entries().filter((e) => !e.block && e.marker.id !== this.target()?.markerId),
  );

  /** A new thread needs a paragraph; a discussion whose paragraph changed can only be answered. */
  protected canStartThread = computed(() => this.target()?.block != null);
  protected showComposer = computed(
    () => !this.discussion.signedIn() || this.canStartThread() || this.replyingTo() !== null,
  );
  protected canSend = computed(
    () =>
      this.draft().trim().length > 0 &&
      this.draft().length <= MAX_BODY &&
      !this.discussion.busy(),
  );

  protected quoteText = computed(() => {
    const quote = this.target()?.quote ?? '';
    return quote.length >= 80 ? `${quote}...` : quote;
  });

  protected displayName(comment: CommentView): string {
    return comment.author?.displayName ?? '';
  }

  protected initials(comment: CommentView): string {
    return this.displayName(comment)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('');
  }

  protected timeAgo(iso: string): string {
    const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
    const formatter = new Intl.RelativeTimeFormat(this.locale, { style: 'short', numeric: 'auto' });
    const steps: [Intl.RelativeTimeFormatUnit, number][] = [
      ['day', 86400],
      ['hour', 3600],
      ['minute', 60],
    ];
    for (const [unit, size] of steps) {
      if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
    }
    return formatter.format(0, 'second');
  }

  protected isPinned(thread: ThreadView, comment: CommentView): boolean {
    return thread.resolved && thread.acceptedReplyId === comment.id;
  }

  protected reply(thread: ThreadView, comment: CommentView): void {
    this.replyingTo.set({ rootId: thread.root.id, name: this.displayName(comment) });
  }

  protected onInput(event: Event): void {
    this.draft.set((event.target as HTMLTextAreaElement).value);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void this.send();
    }
  }

  protected async send(): Promise<void> {
    if (!this.canSend()) return;
    const parentId = this.replyingTo()?.rootId ?? null;
    if (await this.discussion.submit(this.draft().trim(), parentId)) {
      this.draft.set('');
      this.replyingTo.set(null);
    }
  }

  protected async remove(comment: CommentView): Promise<void> {
    if (this.confirmingDelete() !== comment.id) {
      this.confirmingDelete.set(comment.id);
      return;
    }
    this.confirmingDelete.set(null);
    await this.discussion.remove(comment.id);
  }

  protected openEntry(entry: DiscussionEntry): void {
    this.replyingTo.set(null);
    this.discussion.openMarker(entry.marker, entry.block);
  }

  protected onHandleDown(event: PointerEvent): void {
    this.swipeStart = event.clientY;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  protected onHandleUp(event: PointerEvent): void {
    if (this.swipeStart !== null && event.clientY - this.swipeStart > SWIPE_CLOSE_PX) {
      this.discussion.close();
    }
    this.swipeStart = null;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.discussion.close();
  }
}
