import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  LOCALE_ID,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DiscussionService } from '../discussion/discussion.service';
import { isPhoneViewport } from '../shared/breakpoints';
import { AskAiTarget, buildAskAiPrompt } from '../shared/ask-ai-prompt';
import { TextHighlightService } from '../services/text-highlight.service';
import { conversationsAt } from './kurz-anchor';
import { KurzAvatar } from './kurz-avatar';
import { answerToPlain, renderKurzText } from './kurz-text';
import { KURZ_MAX_QUESTION, KurzCitation, KurzError, KurzMessage, KurzScope } from './kurz.model';
import { KurzService } from './kurz.service';

type Notice = { messageId: string; kind: 'copied' | 'reported' | 'shared' | 'failed' };

/**
 * The "Ask the Kurz" tab of the panel: the student's private conversation about a paragraph, a passage of
 * it, or the whole post. It shows what the server sent (the answers are checked there) and never builds
 * an answer itself. The context comes from where the student came in: the panel's target.
 */
@Component({
  selector: 'app-kurz-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, KurzAvatar],
  templateUrl: './kurz-tab.html',
  styleUrl: './kurz-tab.css',
})
export class KurzTab {
  protected kurz = inject(KurzService);
  protected discussion = inject(DiscussionService);
  private highlight = inject(TextHighlightService);
  private locale = inject(LOCALE_ID);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private scroller = viewChild<ElementRef<HTMLElement>>('scroll');

  protected readonly maxQuestion = KURZ_MAX_QUESTION;
  protected draft = signal('');
  protected error = signal<KurzError | null>(null);
  protected notice = signal<Notice | null>(null);
  /** The student took the passage off ("x"): the question is about the whole post. */
  protected wholePost = signal(false);
  protected adult = signal(false);
  protected acceptingTerms = signal(false);
  protected termsFailed = signal(false);
  protected reporting = signal<string | null>(null);
  protected reportNote = signal('');
  protected moreOpen = signal<string | null>(null);
  protected openInMenu = signal(false);

  protected target = this.discussion.target;
  protected status = this.kurz.status;
  protected asking = this.kurz.asking;

  /** The passage the conversation is about: what they selected, else the paragraph. Nothing for the whole post. */
  protected passage = computed(() => {
    if (this.wholePost()) return '';
    const target = this.target();
    return target?.selection || target?.block?.quote || '';
  });

  protected scope = computed<KurzScope>(() => {
    const target = this.target();
    if (this.wholePost() || !target) return { anchorKey: null, blockIndex: null, selection: null };
    return {
      anchorKey: target.block?.key ?? null,
      blockIndex: target.block?.index ?? null,
      selection: target.selection ?? null,
    };
  });

  /** Every conversation of this place of the post, oldest first. */
  private here = computed(() => conversationsAt(this.kurz.conversations(), this.scope().anchorKey));

  /** The conversation a new question continues: the one about the same selection, else the latest one here. */
  private active = computed(() => {
    const selection = this.scope().selection;
    const list = this.here();
    return (selection ? list.filter((c) => c.selection === selection).at(-1) : list.at(-1)) ?? null;
  });

  protected messages = computed<KurzMessage[]>(() => this.here().flatMap((c) => c.messages));
  protected stale = computed(() => this.here().some((c) => c.stale));

  protected gate = computed<'signIn' | 'terms' | null>(() => {
    if (!this.kurz.signedIn()) return 'signIn';
    return this.status()?.termsRequired ? 'terms' : null;
  });
  protected blocked = computed(() => this.status()?.blocked ?? null);
  /** The platform's budget is worth a line once it runs low, or whenever it is what stops them. */
  protected budgetWarning = computed(() => {
    const status = this.status();
    if (!status) return null;
    const stopped = status.blocked?.reason.startsWith('PLATFORM_BUDGET') ?? false;
    return stopped || status.platformBudget.usedPercent >= 80 ? status.platformBudget : null;
  });
  protected canAsk = computed(
    () =>
      this.draft().trim().length > 0 &&
      this.draft().length <= KURZ_MAX_QUESTION &&
      !this.asking() &&
      this.gate() === null &&
      this.blocked() === null,
  );

  constructor() {
    // Another paragraph or another place: the old context, drafts and notices do not follow.
    effect(() => {
      this.target();
      untracked(() => {
        this.wholePost.set(false);
        this.error.set(null);
        this.notice.set(null);
        this.reporting.set(null);
        this.moreOpen.set(null);
      });
    });
    // A new answer or question brings the view to the bottom.
    effect(() => {
      this.messages().length;
      this.asking();
      untracked(() => this.scrollToEnd());
    });
  }

  protected html(text: string): string {
    return renderKurzText(text);
  }

  protected citation(answer: KurzMessage['answer'], n: number): KurzCitation | undefined {
    return answer.citations.find((c) => c.n === n);
  }

  protected citeLabel(citation: KurzCitation): string {
    return citation.source === 'S1'
      ? $localize`:@@kurz.citeAria:Show the cited passage of the post, citation ${citation.n}:n:`
      : $localize`:@@kurz.citeLinkAria:Open ${citation.title}:title:, citation ${citation.n}:n:`;
  }

  /** The post's own passages scroll to the text; another post is a link (the template uses `routerLink`). */
  protected goToPassage(citation: KurzCitation): void {
    if (citation.source !== 'S1') return;
    if (isPhoneViewport()) this.discussion.close();
    this.highlight.focusPassage(citation.quote);
  }

  protected async ask(text: string = this.draft()): Promise<void> {
    const question = text.trim();
    if (!question || this.asking() || this.gate() !== null || this.blocked() !== null) return;
    if (question.length > KURZ_MAX_QUESTION) return;
    this.error.set(null);
    this.notice.set(null);
    const outcome = await this.kurz.ask(question, this.scope(), this.active()?.id ?? null);
    if (outcome.ok) this.draft.set('');
    else this.error.set(outcome.error);
  }

  protected onEnter(event: Event): void {
    const key = event as KeyboardEvent;
    if (key.shiftKey || key.isComposing) return;
    key.preventDefault();
    void this.ask();
  }

  protected async acceptTerms(): Promise<void> {
    if (!this.adult() || this.acceptingTerms()) return;
    this.acceptingTerms.set(true);
    this.termsFailed.set(false);
    const ok = await this.kurz.acceptTerms(true);
    this.acceptingTerms.set(false);
    this.termsFailed.set(!ok);
  }

  protected dropPassage(): void {
    this.wholePost.set(true);
  }

  // ---- per answer ----

  protected async copy(message: KurzMessage): Promise<void> {
    try {
      await navigator.clipboard.writeText(answerToPlain(message.answer));
      this.notice.set({ messageId: message.id, kind: 'copied' });
    } catch {
      this.notice.set({ messageId: message.id, kind: 'failed' });
    }
    this.moreOpen.set(null);
  }

  protected async useful(message: KurzMessage): Promise<void> {
    if (message.helpful === true) return;
    if (!(await this.kurz.rate(message.id, true)))
      this.notice.set({ messageId: message.id, kind: 'failed' });
  }

  protected startReport(message: KurzMessage): void {
    this.reportNote.set('');
    this.reporting.set(message.id);
    this.moreOpen.set(null);
  }

  protected async sendReport(message: KurzMessage): Promise<void> {
    const ok = await this.kurz.report(message.id, this.reportNote());
    this.reporting.set(null);
    this.notice.set({ messageId: message.id, kind: ok ? 'reported' : 'failed' });
  }

  protected async share(message: KurzMessage): Promise<void> {
    const ok = await this.kurz.share(message.id);
    this.notice.set({ messageId: message.id, kind: ok ? 'shared' : 'failed' });
    this.moreOpen.set(null);
  }

  /** After sharing: the exchange is now a comment, so the discussion tab opens on it. */
  protected seeDiscussion(): void {
    const block = this.target()?.block;
    const marker = block
      ? this.discussion
          .markers()
          .find((m) => m.anchorKey === block.key && m.blockIndex === block.index)
      : undefined;
    if (marker) this.discussion.openMarker(marker, block);
    else this.discussion.tab.set('discussion');
  }

  protected toggleMore(id: string): void {
    this.moreOpen.update((open) => (open === id ? null : id));
  }

  // ---- "Open in" ----

  protected openIn(app: AskAiTarget): void {
    const passage = this.passage();
    const prompt = buildAskAiPrompt(passage, passage === '', window.location.href, this.draft());
    // The same fallback as the selection menu: a long prompt is copied, and Gemini takes no `?q=` for sure.
    if (prompt.mode === 'clipboard' || app === 'gemini') {
      void navigator.clipboard?.writeText(prompt.promptText).catch(() => undefined);
    }
    window.open(prompt.urls[app], '_blank', 'noopener');
    this.openInMenu.set(false);
  }

  // ---- text of the states ----

  protected when(iso: string | null): string {
    if (!iso) return '';
    return new Intl.DateTimeFormat(this.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );
  }

  protected scrollToEnd(): void {
    if (!this.isBrowser) return;
    const el = this.scroller()?.nativeElement;
    if (el) requestAnimationFrame(() => (el.scrollTop = el.scrollHeight));
  }
}
