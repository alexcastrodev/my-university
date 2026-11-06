import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { PublicBook } from '../../models/public-profile.model';

/**
 * The panel beside the library shelf, laid out like the top of a paper's page: the title, then the link and the
 * length as a short list, then the comment. It has no box of its own; the column it sits in gives it room.
 */
@Component({
  selector: 'app-book-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './book-summary.html',
  styleUrl: './book-summary.css',
})
export class BookSummary {
  readonly book = input.required<PublicBook>();

  protected paragraphs = computed(() => (this.book().comment ?? '').split('\n').filter((p) => p.trim()));
}
