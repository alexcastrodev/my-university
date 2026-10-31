import { ChangeDetectionStrategy, Component, DestroyRef, LOCALE_ID, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject, catchError, map, of, switchMap, tap } from 'rxjs';
import { LIBRARY_STATUSES, LibraryFacets, LibraryPage, LibraryQuery, LibraryStatus } from '../../models/paper.model';
import { PaperLibraryService } from '../../services/paper-library.service';
import { SeoService } from '../../services/seo.service';
import { formatPaperDate, libraryStatusLabel, paperTypeLabel } from '../../shared/paper-format';
import { LIBRARY_SORTS, libraryQueryParams, parseLibraryQuery } from './paper-library-query';

const AUTHORS_SHOWN = 4;

/** The reader's own papers: filter by reading status, tag and text, sort by date or rating. Client-rendered, private. */
@Component({
  selector: 'app-paper-library',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './paper-library.html',
  styleUrls: ['./papers-list.css', './paper-library.css'],
})
export class PaperLibraryPage implements OnInit {
  private library = inject(PaperLibraryService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private seo = inject(SeoService);
  private locale = inject(LOCALE_ID);
  private destroyRef = inject(DestroyRef);

  protected readonly paperTypeLabel = paperTypeLabel;
  protected readonly statusLabel = libraryStatusLabel;
  protected readonly libraryQueryParams = libraryQueryParams;
  protected readonly authorsShown = AUTHORS_SHOWN;
  protected readonly statuses = LIBRARY_STATUSES;
  protected readonly sorts = LIBRARY_SORTS;

  protected query = signal<LibraryQuery>({});
  protected searchText = signal('');
  protected page = signal<LibraryPage | null>(null);
  protected facets = signal<LibraryFacets | null>(null);
  protected loading = signal(true);
  protected failed = signal(false);
  protected signedOut = signal(false);

  private request = new Subject<LibraryQuery>();

  protected pages = computed(() => {
    const p = this.page();
    return p ? Math.max(1, Math.ceil(p.total / p.limit)) : 1;
  });
  protected currentPage = computed(() => this.page()?.page ?? 1);
  protected filtered = computed(() => {
    const { q, status, tag } = this.query();
    return !!(q || status || tag);
  });
  protected countOf = (status: LibraryStatus) => this.facets()?.statuses.find((s) => s.value === status)?.count ?? 0;
  protected prevParams = computed(() => libraryQueryParams({ ...this.query(), page: this.currentPage() > 2 ? this.currentPage() - 1 : undefined }));
  protected nextParams = computed(() => libraryQueryParams({ ...this.query(), page: this.currentPage() + 1 }));

  constructor() {
    this.request
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.failed.set(false);
        }),
        switchMap((query) =>
          this.library.list(query).pipe(
            catchError((err) => {
              if (err?.status === 401) this.signedOut.set(true);
              else this.failed.set(true);
              return of(null);
            }),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((page) => {
        this.page.set(page);
        this.loading.set(false);
      });

    this.route.queryParamMap
      .pipe(map(parseLibraryQuery), takeUntilDestroyed(this.destroyRef))
      .subscribe((query) => {
        this.query.set(query);
        this.searchText.set(query.q ?? '');
        this.request.next(query);
      });
  }

  ngOnInit() {
    this.seo.set({
      title: 'My library',
      description: 'Your private paper library.',
      path: '/papers/library',
      noindex: true,
    });
    // Counts per status and the tags are a convenience: without them the list and the search still work.
    this.loadFacets();
  }

  protected retry(): void {
    this.loadFacets();
    this.request.next(this.query());
  }

  protected onSearch(event: Event): void {
    event.preventDefault();
    this.go({ q: this.searchText().trim() || undefined });
  }

  protected onTag(value: string): void {
    this.go({ tag: value || undefined });
  }

  protected onSort(value: string): void {
    this.go({ sort: value === 'added' ? undefined : this.sorts.find((s) => s === value) });
  }

  protected clear(key: keyof LibraryQuery): void {
    this.go({ [key]: undefined });
  }

  protected clearAll(): void {
    void this.router.navigate([], { queryParams: this.query().sort ? { sort: this.query().sort } : {} });
  }

  protected date(value: string): string {
    return formatPaperDate(value, this.locale);
  }

  private loadFacets(): void {
    this.library.facets().subscribe({ next: (facets) => this.facets.set(facets), error: () => undefined });
  }

  private go(patch: Partial<LibraryQuery>): void {
    // A new filter starts again from the first page.
    void this.router.navigate([], { queryParams: libraryQueryParams({ ...this.query(), page: undefined, ...patch }) });
  }
}
