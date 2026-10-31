import { ChangeDetectionStrategy, Component, LOCALE_ID, computed, inject, input, output, signal } from '@angular/core';
import { Annotation, AnnotationKind } from '../../models/paper.model';
import { formatPaperDate } from '../../shared/paper-format';
import { AnnotationText } from './annotation-text';

export function annotationKindLabel(kind: AnnotationKind): string {
  switch (kind) {
    case 'note':
      return $localize`:@@papers.notes.kind.note:Note`;
    case 'highlight':
      return $localize`:@@papers.notes.kind.highlight:Highlight`;
    case 'comment':
      return $localize`:@@papers.notes.kind.comment:Comment`;
    case 'question':
      return $localize`:@@papers.notes.kind.question:Question`;
    case 'bookmark':
      return $localize`:@@papers.notes.kind.bookmark:Bookmark`;
  }
}

/**
 * One note or annotation of the reader, with what can be done to it. It changes nothing by itself: the page
 * that holds it calls the API and hands back the result, so a failed change is shown where the list is.
 */
@Component({
  selector: 'app-annotation-item',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AnnotationText],
  templateUrl: './annotation-item.html',
  styleUrl: './annotation-item.css',
})
export class AnnotationItem {
  private locale = inject(LOCALE_ID);

  readonly annotation = input.required<Annotation>();
  /** The one being changed right now: its buttons wait. */
  readonly busy = input(false);

  readonly open = output<void>();
  readonly save = output<string>();
  readonly remove = output<void>();
  readonly keep = output<void>();

  protected editing = signal(false);
  protected draft = signal('');
  protected confirming = signal(false);

  protected kind = computed(() => annotationKindLabel(this.annotation().kind));
  protected when = computed(() => formatPaperDate(this.annotation().createdAt.slice(0, 10), this.locale));
  protected pageLabel = computed(() => {
    const page = this.annotation().page;
    return $localize`:@@papers.notes.page:Page ${page}:page:`;
  });
  protected olderLabel = computed(() => {
    const { page, pdfVersion } = this.annotation();
    return $localize`:@@papers.notes.olderPdf:Page ${page}:page: of an earlier PDF (version ${pdfVersion}:version:)`;
  });
  /** A note and a comment are their text; a highlight or a bookmark may have none. */
  protected needsText = computed(() => ['note', 'comment', 'question'].includes(this.annotation().kind));
  protected canSave = computed(() => !this.needsText() || this.draft().trim().length > 0);

  protected startEdit(): void {
    this.draft.set(this.annotation().body ?? '');
    this.editing.set(true);
    this.confirming.set(false);
  }

  protected submit(event: Event): void {
    event.preventDefault();
    if (!this.canSave()) return;
    this.save.emit(this.draft());
    this.editing.set(false);
  }
}
