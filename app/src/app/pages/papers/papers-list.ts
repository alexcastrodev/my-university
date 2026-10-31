import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject, catchError, map, of, switchMap, tap } from 'rxjs';
import { PAPER_TYPES, PUBLICATION_STAGES, PaperFacets, PaperPage, PaperQuery, PaperSort, PaperType } from '../../models/paper.model';
import { PapersService } from '../../services/papers.service';
import { SeoService } from '../../services/seo.service';
import { paperTypeLabel, stageLabel } from '../../shared/paper-format';
import { PaperRow } from './paper-row';
import { paperQueryParams, parsePaperQuery } from './papers-query';

@Component({
  selector: 'app-papers-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PaperRow],
  templateUrl: './papers-list.html',
  styleUrl: './papers-list.css',
})
export class PapersListPage implements OnInit {
  private papers = inject(PapersService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private seo = inject(SeoService);
  private destroyRef = inject(DestroyRef);

  protected readonly paperTypeLabel = paperTypeLabel;
  protected readonly stageLabel = stageLabel;
  protected readonly stages = PUBLICATION_STAGES;
  protected readonly paperQueryParams = paperQueryParams;

  protected query = signal<PaperQuery>({});
  protected searchText = signal('');
  protected page = signal<PaperPage | null>(null);
  protected facets = signal<PaperFacets | null>(null);
  protected loading = signal(true);
  protected failed = signal(false);

  private request = new Subject<PaperQuery>();

  protected pages = computed(() => {
    const p = this.page();
    return p ? Math.max(1, Math.ceil(p.total / p.limit)) : 1;
  });
  protected currentPage = computed(() => this.page()?.page ?? 1);
  /** Whether anything narrows the list; an empty result then means "no match" rather than "no papers yet". */
  protected filtered = computed(() => {
    const { q, author, keyword, area, type, stage } = this.query();
    return !!(q || author || keyword || area || type || stage);
  });
  protected types = computed(() => {
    const present = new Set(this.facets()?.types.map((t) => t.value));
    return PAPER_TYPES.filter((t) => present.has(t));
  });
  protected prevParams = computed(() => paperQueryParams({ ...this.query(), page: this.currentPage() > 2 ? this.currentPage() - 1 : undefined }));
  protected nextParams = computed(() => paperQueryParams({ ...this.query(), page: this.currentPage() + 1 }));

  constructor() {
    this.request
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.failed.set(false);
        }),
        switchMap((query) =>
          this.papers.list(query).pipe(
            catchError(() => {
              this.failed.set(true);
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
      .pipe(map(parsePaperQuery), takeUntilDestroyed(this.destroyRef))
      .subscribe((query) => {
        this.query.set(query);
        this.searchText.set(query.q ?? '');
        this.request.next(query);
      });
  }

  ngOnInit() {
    this.seo.set({
      title: 'Papers',
      description: 'Research papers behind the concepts: search the catalog by title, author, DOI, keyword, research area and publication type.',
      path: '/papers',
    });
    // The selects are a convenience: without them the search box and the links still filter.
    this.papers.facets().subscribe({ next: (facets) => this.facets.set(facets), error: () => undefined });
  }

  protected retry(): void {
    this.request.next(this.query());
  }

  protected onSearch(event: Event): void {
    event.preventDefault();
    this.go({ q: this.searchText().trim() || undefined });
  }

  protected onType(value: string): void {
    this.go({ type: (value || undefined) as PaperType | undefined });
  }

  protected onStage(value: string): void {
    this.go({ stage: PUBLICATION_STAGES.find((s) => s === value) });
  }

  protected onArea(value: string): void {
    this.go({ area: value || undefined });
  }

  protected onSort(value: string): void {
    this.go({ sort: value === 'title' ? ('title' as PaperSort) : undefined });
  }

  protected clear(key: keyof PaperQuery): void {
    this.go({ [key]: undefined });
  }

  protected clearAll(): void {
    void this.router.navigate([], { queryParams: this.query().sort ? { sort: this.query().sort } : {} });
  }


  private go(patch: Partial<PaperQuery>): void {
    // A new filter starts again from the first page.
    void this.router.navigate([], { queryParams: paperQueryParams({ ...this.query(), page: undefined, ...patch }) });
  }
}
