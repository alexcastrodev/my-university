import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { Collection } from '../../models/paper.model';
import { PaperLibraryService } from '../../services/paper-library.service';

/**
 * The reader's collections (#188): create, rename and delete. A collection only groups papers of the library,
 * so deleting one says what stays. It calls the API itself and tells the page when something changed, so the
 * page can read the list again.
 */
@Component({
  selector: 'app-paper-collections',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './paper-collections.html',
  styleUrl: './paper-collections.css',
})
export class PaperCollections {
  private library = inject(PaperLibraryService);

  readonly collections = input.required<Collection[]>();
  readonly changed = output<void>();

  protected name = signal('');
  /** The collection being renamed, and the name typed for it. */
  protected renaming = signal<string | null>(null);
  protected newName = signal('');
  /** The collection waiting for the reader to confirm its deletion. */
  protected deleting = signal<string | null>(null);
  protected busy = signal(false);
  protected problem = signal<string | null>(null);

  protected create(event: Event): void {
    event.preventDefault();
    const name = this.name().trim();
    if (!name) return;
    this.run(this.library.createCollection(name), () => this.name.set(''));
  }

  protected startRename(c: Collection): void {
    this.deleting.set(null);
    this.problem.set(null);
    this.newName.set(c.name);
    this.renaming.set(c.id);
  }

  protected rename(event: Event, id: string): void {
    event.preventDefault();
    const name = this.newName().trim();
    if (name) this.run(this.library.renameCollection(id, name), () => this.renaming.set(null));
  }

  protected startDelete(id: string): void {
    this.renaming.set(null);
    this.problem.set(null);
    this.deleting.set(id);
  }

  protected remove(id: string): void {
    this.run(this.library.deleteCollection(id), () => this.deleting.set(null));
  }

  private run(call: Observable<unknown>, done: () => void): void {
    this.busy.set(true);
    this.problem.set(null);
    call.subscribe({
      next: () => {
        this.busy.set(false);
        done();
        this.changed.emit();
      },
      error: (err: unknown) => this.fail(err instanceof HttpErrorResponse ? (err.error?.code ?? null) : null),
    });
  }

  private fail(code: string | null): void {
    this.busy.set(false);
    this.problem.set(
      code === 'name_taken'
        ? $localize`:@@papers.collections.error.taken:You already have a collection with that name.`
        : code === 'collections_limit'
          ? $localize`:@@papers.collections.error.limit:You have reached the limit of collections. Delete one to add another.`
          : code === 'name_invalid'
            ? $localize`:@@papers.collections.error.invalid:A collection name is plain text.`
            : $localize`:@@papers.collections.error.generic:That could not be saved. Try again.`,
    );
  }
}
