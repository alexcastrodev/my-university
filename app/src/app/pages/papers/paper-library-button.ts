import { ChangeDetectionStrategy, Component, afterNextRender, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable, finalize } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { PaperLibraryService } from '../../services/paper-library.service';

/**
 * "Add to my library" on a public paper: one button, nothing else. What the reader keeps about the paper
 * (status, rating, tags) is edited in the library itself. Private, so it only exists in the browser.
 */
@Component({
  selector: 'app-paper-library-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './paper-library-button.html',
  styleUrl: './paper-library-button.css',
})
export class PaperLibraryButton {
  readonly paperId = input.required<number>();

  private library = inject(PaperLibraryService);
  private auth = inject(AuthService);

  /** Set once the page is in the browser: the server renders none of this, so hydration has nothing to disagree on. */
  protected ready = signal(false);
  protected signedIn = computed(() => this.auth.currentUser() !== null);
  /** `null` until the library has answered, so the button never starts in the wrong state. */
  protected inLibrary = signal<boolean | null>(null);
  protected loadFailed = signal(false);
  protected saveFailed = signal(false);
  protected busy = signal(false);

  constructor() {
    afterNextRender(() => this.ready.set(true));
    effect(() => {
      const id = this.paperId();
      if (this.ready() && this.signedIn()) untracked(() => this.load(id));
    });
  }

  protected load(id = this.paperId()): void {
    this.inLibrary.set(null);
    this.loadFailed.set(false);
    this.library.get(id).subscribe({
      next: (entry) => this.inLibrary.set(entry !== null),
      error: () => this.loadFailed.set(true),
    });
  }

  protected add(): void {
    this.change(this.library.add(this.paperId()), true);
  }

  protected remove(): void {
    this.change(this.library.remove(this.paperId()), false);
  }

  private change(request: Observable<unknown>, inLibrary: boolean): void {
    this.saveFailed.set(false);
    this.busy.set(true);
    request.pipe(finalize(() => this.busy.set(false))).subscribe({
      next: () => this.inLibrary.set(inLibrary),
      error: () => this.saveFailed.set(true),
    });
  }
}
