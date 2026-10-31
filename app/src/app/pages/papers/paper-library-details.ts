import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { EMPTY, Observable, Subject, catchError, concatMap, finalize, tap } from 'rxjs';
import { Collection, LIBRARY_STATUSES, LibraryChange, LibraryEntry } from '../../models/paper.model';
import { PaperLibraryService } from '../../services/paper-library.service';
import { libraryStatusLabel } from '../../shared/paper-format';

/** What a reader keeps about one paper in the library: status, rating, finishing day, tags and collections. Private. */
@Component({
  selector: 'app-paper-library-details',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './paper-library-details.html',
  styleUrl: './paper-library-details.css',
})
export class PaperLibraryDetails implements OnInit {
  /** The entry as the list had it. Read once: after that this component keeps the latest one the server sent. */
  readonly initial = input.required<LibraryEntry>({ alias: 'entry' });

  private library = inject(PaperLibraryService);

  protected readonly statuses = LIBRARY_STATUSES;
  protected readonly statusLabel = libraryStatusLabel;
  protected readonly ratings = [1, 2, 3, 4, 5];

  protected entry = signal<LibraryEntry | null>(null);
  protected saveFailed = signal(false);
  protected tagText = signal('');
  /** All the reader's collections, to tick the ones this paper sits in (#188). */
  protected collections = signal<Collection[]>([]);
  protected collectionFailed = signal(false);
  protected memberOf = computed(() => new Set(this.entry()?.collections.map((c) => c.id)));

  /** Requests in flight. Only the tag buttons wait on it: the fields stay usable so focus is not lost. */
  private pending = signal(0);
  protected busy = computed(() => this.pending() > 0);
  /** Edits are sent one at a time, each built from the entry as the last one left it, so two quick tags both land. */
  private edits = new Subject<(entry: LibraryEntry) => LibraryChange>();

  /** The latest day a paper can have been finished: today, in the reader's own time zone. */
  protected today = new Date().toLocaleDateString('sv');

  constructor() {
    this.edits
      .pipe(
        concatMap((build) => {
          const entry = this.entry();
          if (!entry) return EMPTY.pipe(finalize(() => this.settle()));
          return this.library.update(entry.paperId, build(entry)).pipe(
            tap((stored) => this.entry.set(stored)),
            catchError(() => {
              this.failSave(entry);
              return EMPTY;
            }),
            finalize(() => this.settle()),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe();
  }

  ngOnInit(): void {
    this.entry.set(this.initial());
    // Without the list the rest of the details still work: there is just nothing to tick.
    this.library.collections().subscribe({ next: (list) => this.collections.set(list), error: () => undefined });
  }

  /** Puts the paper in the collection or takes it out; the box goes back to what is stored when that fails. */
  protected toggle(collection: Collection, box: HTMLInputElement): void {
    const entry = this.entry();
    if (!entry) return;
    const joining = box.checked;
    this.collectionFailed.set(false);
    const call: Observable<unknown> = joining
      ? this.library.addToCollection(collection.id, entry.paperId)
      : this.library.takeFromCollection(collection.id, entry.paperId);
    call.subscribe({
      next: () =>
        this.entry.update((e) =>
          e && { ...e, collections: joining ? [...e.collections, { id: collection.id, name: collection.name }] : e.collections.filter((c) => c.id !== collection.id) },
        ),
      error: () => {
        box.checked = !joining;
        this.collectionFailed.set(true);
      },
    });
  }

  protected setStatus(value: string): void {
    const status = LIBRARY_STATUSES.find((s) => s === value);
    if (status) this.edit(() => ({ status }));
  }

  protected setRating(value: string): void {
    this.edit(() => ({ rating: value ? Number(value) : null }));
  }

  protected setCompleted(value: string): void {
    this.edit(() => ({ completedAt: value || null }));
  }

  protected addTag(event: Event): void {
    event.preventDefault();
    const tag = this.tagText().trim();
    if (!tag) return;
    // Cleared at once, so what the reader types while this saves is theirs and is not wiped when it lands.
    this.tagText.set('');
    this.edit((entry) => ({ tags: [...entry.tags, tag] }));
  }

  protected removeTag(tag: string): void {
    this.edit((entry) => ({ tags: entry.tags.filter((t) => t !== tag) }));
  }

  private edit(build: (entry: LibraryEntry) => LibraryChange): void {
    this.saveFailed.set(false);
    this.pending.update((n) => n + 1);
    this.edits.next(build);
  }

  private settle(): void {
    this.pending.update((n) => n - 1);
  }

  /**
   * Shows the error and goes back to what is stored. The entry is dropped for a moment so the controls are
   * rebuilt: a select left on the value the reader picked would not move on its own.
   */
  private failSave(previous: LibraryEntry): void {
    this.saveFailed.set(true);
    this.entry.set(null);
    this.library.get(previous.paperId).subscribe({
      next: (stored) => this.entry.set(stored ?? previous),
      error: () => this.entry.set(previous),
    });
  }
}
