import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, LOCALE_ID, computed, inject, input, output, signal } from '@angular/core';
import { Annotation, AnnotationShare, ShareVisibility } from '../../models/paper.model';
import { PaperAnnotationsService } from '../../services/paper-annotations.service';
import { formatPaperDate } from '../../shared/paper-format';

/** Names are separated by spaces, commas or semicolons. */
const NAMES = /[\s,;]+/;

/**
 * What to do with one annotation of a public paper that the reader may publish (#187): who it is for, how old
 * the published copy is, and taking it back. Nothing is shared until the reader presses Share, and the
 * published copy is a copy: it says so here, and says what is in it. It calls the API itself, so the list that
 * holds it only has to take the new `share` of the annotation.
 */
@Component({
  selector: 'app-annotation-share',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './annotation-share.html',
  styleUrl: './annotation-share.css',
})
export class AnnotationSharePanel {
  private annotations = inject(PaperAnnotationsService);
  private locale = inject(LOCALE_ID);

  readonly paperId = input.required<string>();
  readonly annotation = input.required<Annotation>();
  /** The annotation's share after a change, or null once it is taken back. */
  readonly changed = output<AnnotationShare | null>();

  protected open = signal(false);
  protected visibility = signal<ShareVisibility>('public');
  protected names = signal('');
  protected busy = signal(false);
  protected problem = signal<string | null>(null);

  protected share = computed(() => this.annotation().share);
  /** The text changed after the copy was made, so readers still see the older one. */
  protected outdated = computed(() => {
    const share = this.share();
    return !!share && this.annotation().updatedAt > share.updatedAt;
  });
  protected audience = computed(() => {
    const share = this.share();
    if (!share) return '';
    if (share.visibility === 'public') return $localize`:@@papers.share.audience.public:Shared with everyone who opens the paper`;
    const names = share.recipients.map((r) => r.name).join(', ');
    return $localize`:@@papers.share.audience.users:Shared with ${names}:names:`;
  });
  protected since = computed(() => formatPaperDate((this.share()?.sharedAt ?? '').slice(0, 10), this.locale));
  protected canSend = computed(() => !this.busy() && (this.visibility() === 'public' || this.parsed().length > 0));
  private parsed = computed(() => this.names().split(NAMES).filter(Boolean));

  protected begin(): void {
    this.visibility.set(this.share()?.visibility ?? 'public');
    this.names.set('');
    this.problem.set(null);
    this.open.set(true);
  }

  protected submit(event: Event): void {
    event.preventDefault();
    if (!this.canSend()) return;
    this.send(this.visibility(), this.parsed());
  }

  /** Makes the copy again from the annotation as it is now, for the same readers. */
  protected refresh(): void {
    const share = this.share();
    if (share) this.send(share.visibility, share.recipients.map((r) => r.id));
  }

  protected stop(): void {
    this.busy.set(true);
    this.problem.set(null);
    this.annotations.unshare(this.paperId(), this.annotation().id).subscribe({
      next: () => {
        this.busy.set(false);
        this.changed.emit(null);
      },
      error: () => this.fail(null),
    });
  }

  private send(visibility: ShareVisibility, recipients: string[]): void {
    this.busy.set(true);
    this.problem.set(null);
    this.annotations
      .share(this.paperId(), this.annotation().id, visibility === 'users' ? { visibility, recipients } : { visibility })
      .subscribe({
        next: (share) => {
          this.busy.set(false);
          this.open.set(false);
          this.changed.emit(share);
        },
        error: (err: unknown) => this.fail(err instanceof HttpErrorResponse ? (err.error?.code ?? null) : null),
      });
  }

  private fail(code: string | null): void {
    this.busy.set(false);
    this.problem.set(
      code === 'recipient_not_found'
        ? $localize`:@@papers.share.error.notFound:No reader has that public profile. Use the part after /u/ in their profile link; readers whose profile is not public cannot be named.`
        : code === 'recipient_is_you'
          ? $localize`:@@papers.share.error.you:You already see what you share. Name someone else.`
          : code === 'shares_limit'
            ? $localize`:@@papers.share.error.limit:You have reached the limit of shared annotations. Stop sharing one to share another.`
            : $localize`:@@papers.share.error.generic:That could not be saved. Try again.`,
    );
  }
}
