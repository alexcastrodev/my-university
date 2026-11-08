import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { BookmarkTab } from '../../models/bookmark.model';
import { AuthService } from '../../services/auth.service';
import { BookmarkService } from '../../services/bookmark.service';

@Component({
  selector: 'app-concept-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './concept-actions.html',
  styleUrl: './concept-actions.css',
})
export class ConceptActions {
  read = input<boolean>(false);
  marking = input<boolean>(false);
  labUrl = input<string | null | undefined>(null);
  lockedLabel = input<string>('concept');
  /** Where this concept lives, for the bookmark. Without a module (Java Minute episodes) there is nothing to bookmark. */
  module = input<string | null>(null);
  slug = input<string | null>(null);
  /** Computer Science only: its modules are addressed by discipline. */
  discipline = input<string | undefined>(undefined);
  /** The tab on screen. Bookmarking from the Lab tab brings the reader back to the Lab tab. */
  tab = input<BookmarkTab>('concept');
  markRead = output<void>();

  protected auth = inject(AuthService);
  private bookmarks = inject(BookmarkService);

  protected readonly bookmarkLockedTitle = $localize`:@@conceptActions.bookmarkLocked:Log in to keep a bookmark here`;

  protected target = computed(() => {
    const module = this.module();
    const slug = this.slug();
    return module && slug ? { module, slug, discipline: this.discipline() } : null;
  });

  /** The module's bookmark is on this concept and this tab. */
  protected here = computed(() => {
    const target = this.target();
    return target !== null && this.bookmarks.isBookmarkedHere(target, this.tab());
  });

  onMarkRead(): void {
    if (!this.auth.currentUser() || this.read() || this.marking()) return;
    this.markRead.emit();
  }

  onToggleBookmark(): void {
    const target = this.target();
    if (!target || !this.auth.currentUser()) return;
    this.bookmarks.toggle(target, this.tab());
  }
}
