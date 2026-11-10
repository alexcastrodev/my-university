import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, effect, inject, input, output } from '@angular/core';
import type { ShelfHandle, ShelfLabels } from 'book-shelf';
import { PublicBook } from '../../models/public-profile.model';

/** The words the shelf shows, in the language of the page. */
const LABELS: ShelfLabels = {
  pages: (count) => count === 1
    ? $localize`:@@bookShelf.page:1 page`
    : $localize`:@@bookShelf.pages:${count}:count: pages`,
  open: (title) => $localize`:@@bookShelf.open:Open ${title}:title:`,
  visit: $localize`:@@bookShelf.visit:Go to the book`,
};

/**
 * A thin wrapper around the `book-shelf` package: the package draws and lays out the shelf, this puts it in a
 * page. The package is loaded on demand and only in the browser (nothing here runs on the server), so a
 * page without a shelf never pays for it.
 */
@Component({
  selector: 'app-book-shelf',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
  styleUrl: './book-shelf.css',
})
export class BookShelf {
  readonly books = input.required<PublicBook[]>();
  /** The book that just opened: the details are not drawn here but beside the shelf, in `app-book-summary`. */
  readonly opened = output<PublicBook>();

  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private handle: ShelfHandle | null = null;
  private destroyed = false;

  constructor() {
    afterNextRender(() => {
      void import('book-shelf').then(({ mountBookShelf }) => {
        if (this.destroyed) return;
        this.handle = mountBookShelf(this.host.nativeElement, this.books(), {
          labels: LABELS,
          openFirst: true,
          detail: false,
          // The shelf got `PublicBook`s and hands the same objects back.
          onOpen: (book) => this.opened.emit(book as PublicBook),
        });
      });
    });
    // `books()` is read first, outside the `?.`: while the package is still loading `handle` is null, and an
    // optional call skips its arguments, so the effect would never learn which signal it depends on.
    effect(() => {
      const books = this.books();
      this.handle?.update(books);
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.handle?.destroy();
    });
  }
}
