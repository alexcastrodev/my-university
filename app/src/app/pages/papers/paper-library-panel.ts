import { ChangeDetectionStrategy, Component, LOCALE_ID, afterNextRender, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { EMPTY, Subject, catchError, concatMap, finalize, tap } from 'rxjs';
import { LIBRARY_STATUSES, LibraryChange, LibraryEntry } from '../../models/paper.model';
import { AuthService } from '../../services/auth.service';
import { PaperLibraryService } from '../../services/paper-library.service';
import { formatPaperDate, libraryStatusLabel } from '../../shared/paper-format';

/** "Add to my library" and everything a reader keeps about one paper. Private, so it only exists in the browser. */
@Component({
  selector: 'app-paper-library-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './paper-library-panel.html',
  styleUrl: './paper-library-panel.css',
})
export class PaperLibraryPanel {
  readonly paperId = input.required<number>();

  private library = inject(PaperLibraryService);
  private auth = inject(AuthService);
  private locale = inject(LOCALE_ID);

  protected readonly statuses = LIBRARY_STATUSES;
  protected readonly statusLabel = libraryStatusLabel;
  protected readonly ratings = [1, 2, 3, 4, 5];

  /** Set once the page is in the browser: the server renders none of this, so hydration has nothing to disagree on. */
  protected ready = signal(false);
  protected signedIn = computed(() => this.auth.currentUser() !== null);
  protected entry = signal<LibraryEntry | null>(null);
  protected loading = signal(false);
  protected loadFailed = signal(false);
  protected saveFailed = signal(false);
  protected tagText = signal('');

  /** Requests in flight. Only the add and remove buttons wait on it: the fields stay usable so focus is not lost. */
  private pending = signal(0);
  protected busy = computed(() => this.pending() > 0);
  /** Edits are sent one at a time, each built from the entry as the last one left it, so two quick tags both land. */
  private edits = new Subject<(entry: LibraryEntry) => LibraryChange>();

  /** The latest day a paper can have been finished: today, in the reader's own time zone. */
  protected today = new Date().toLocaleDateString('sv');
  protected addedOn = computed(() => {
    const added = this.entry()?.addedAt;
    return added ? formatPaperDate(added.slice(0, 10), this.locale) : '';
  });

  constructor() {
    afterNextRender(() => this.ready.set(true));
    effect(() => {
      const id = this.paperId();
      if (this.ready() && this.signedIn()) untracked(() => this.load(id));
    });
    this.edits
      .pipe(
        concatMap((build) => {
          const entry = this.entry();
          // The entry is gone when the paper was removed while this edit waited its turn.
          if (!entry) return EMPTY.pipe(finalize(() => this.settle()));
          return this.library.update(entry.paperId, build(entry)).pipe(
            tap((saved) => this.entry.set(saved)),
            catchError(() => {
              this.failSave();
              return EMPTY;
            }),
            finalize(() => this.settle()),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe();
  }

  protected load(id = this.paperId()): void {
    this.loading.set(true);
    this.loadFailed.set(false);
    this.library.get(id).subscribe({
      next: (entry) => {
        this.entry.set(entry);
        this.loading.set(false);
      },
      error: () => {
        this.loadFailed.set(true);
        this.loading.set(false);
      },
    });
  }

  protected add(): void {
    this.begin();
    this.library
      .add(this.paperId())
      .pipe(finalize(() => this.settle()))
      .subscribe({ next: (entry) => this.entry.set(entry), error: () => this.saveFailed.set(true) });
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

  protected remove(): void {
    this.begin();
    this.library
      .remove(this.paperId())
      .pipe(finalize(() => this.settle()))
      .subscribe({ next: () => this.entry.set(null), error: () => this.failSave() });
  }

  private edit(build: (entry: LibraryEntry) => LibraryChange): void {
    this.begin();
    this.edits.next(build);
  }

  private begin(): void {
    this.saveFailed.set(false);
    this.pending.update((n) => n + 1);
  }

  private settle(): void {
    this.pending.update((n) => n - 1);
  }

  /** Shows the error and reloads the entry, so the controls go back to what is actually stored. */
  private failSave(): void {
    this.load();
    this.saveFailed.set(true);
  }
}
