import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Annotation } from '../../models/paper.model';
import { PaperAnnotationsService } from '../../services/paper-annotations.service';
import { AnnotationItem } from './annotation-item';

/**
 * The notes of a paper in the reader's library, and the annotations the PDF outgrew. Highlights, comments,
 * questions and bookmarks on the current PDF are made and seen in the reader; this is where free-form notes
 * live, so they are there with or without a PDF, and where a stale annotation is reviewed.
 */
@Component({
  selector: 'app-paper-notes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AnnotationItem],
  templateUrl: './paper-notes.html',
  styleUrl: './paper-notes.css',
})
export class PaperNotes {
  private annotations = inject(PaperAnnotationsService);

  readonly paperId = input.required<string>();

  protected items = signal<Annotation[]>([]);
  protected version = signal<number | null>(null);
  protected loading = signal(true);
  protected failed = signal(false);
  protected saveError = signal(false);
  protected busyId = signal<string | null>(null);
  protected text = signal('');
  protected adding = signal(false);

  protected notes = computed(() => this.items().filter((a) => a.kind === 'note'));
  protected stale = computed(() => this.items().filter((a) => a.kind !== 'note' && a.stale));
  protected onPdf = computed(() => this.items().filter((a) => a.kind !== 'note' && !a.stale).length);
  protected canAdd = computed(() => this.text().trim().length > 0 && !this.adding());

  constructor() {
    effect(() => this.load(this.paperId()));
  }

  protected load(id: string): void {
    this.loading.set(true);
    this.failed.set(false);
    this.annotations.list(id).subscribe({
      next: (list) => {
        this.items.set(list.items);
        this.version.set(list.version);
        this.loading.set(false);
      },
      error: () => {
        this.failed.set(true);
        this.loading.set(false);
      },
    });
  }

  protected retry(): void {
    this.load(this.paperId());
  }

  protected add(event: Event): void {
    event.preventDefault();
    if (!this.canAdd()) return;
    this.adding.set(true);
    this.saveError.set(false);
    this.annotations.create(this.paperId(), { kind: 'note', body: this.text() }).subscribe({
      next: (note) => {
        this.items.update((all) => [...all, note]);
        this.text.set('');
        this.adding.set(false);
      },
      error: () => {
        this.saveError.set(true);
        this.adding.set(false);
      },
    });
  }

  protected save(a: Annotation, body: string): void {
    this.change(a, this.annotations.update(this.paperId(), a.id, { body }));
  }

  protected keep(a: Annotation): void {
    this.change(a, this.annotations.update(this.paperId(), a.id, { kind: 'note' }));
  }

  protected remove(a: Annotation): void {
    this.busyId.set(a.id);
    this.saveError.set(false);
    this.annotations.remove(this.paperId(), a.id).subscribe({
      next: () => {
        this.items.update((all) => all.filter((x) => x.id !== a.id));
        this.busyId.set(null);
      },
      error: () => {
        this.saveError.set(true);
        this.busyId.set(null);
      },
    });
  }

  private change(a: Annotation, request: ReturnType<PaperAnnotationsService['update']>): void {
    this.busyId.set(a.id);
    this.saveError.set(false);
    request.subscribe({
      next: (changed) => {
        this.items.update((all) => all.map((x) => (x.id === changed.id ? changed : x)));
        this.busyId.set(null);
      },
      error: () => {
        this.saveError.set(true);
        this.busyId.set(null);
      },
    });
  }
}
