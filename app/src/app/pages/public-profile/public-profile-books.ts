import { HttpClient } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, PLATFORM_ID, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BookShelf } from '../../components/book-shelf/book-shelf';
import { PublicBook } from '../../models/public-profile.model';
import { PublicProfilePage } from './public-profile-page';

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'empty' } | { kind: 'ready'; books: PublicBook[] };

/**
 * The Library tab of a public profile: the books the person listed in their file in the repository, as a
 * shelf. Fetched in the browser only, like the profile, since it can turn private at any moment.
 */
@Component({
  selector: 'app-public-profile-books',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BookShelf, RouterLink],
  templateUrl: './public-profile-books.html',
  styleUrl: './public-profile-books.css',
})
export class PublicProfileBooks implements OnInit {
  private http = inject(HttpClient);
  private page = inject(PublicProfilePage);
  private platformId = inject(PLATFORM_ID);

  protected state = signal<State>({ kind: 'loading' });

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) this.load();
  }

  protected load(): void {
    this.state.set({ kind: 'loading' });
    this.http.get<{ books: PublicBook[] }>(`/api/profile/${encodeURIComponent(this.page.key)}/books`).subscribe({
      next: ({ books }) => this.state.set(books.length ? { kind: 'ready', books } : { kind: 'empty' }),
      error: () => this.state.set({ kind: 'error' }),
    });
  }
}
