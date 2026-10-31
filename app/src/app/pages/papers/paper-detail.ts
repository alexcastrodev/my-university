import { ChangeDetectionStrategy, Component, LOCALE_ID, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Observable, Subject, catchError, map, of, switchMap, tap } from 'rxjs';
import { BreadcrumbItem, Breadcrumbs } from '../../components/breadcrumbs/breadcrumbs';
import { ConceptDiscussion } from '../../components/concept-discussion/concept-discussion';
import { DiscussionTopic } from '../../discussion/discussion.model';
import { Paper } from '../../models/paper.model';
import { PapersService } from '../../services/papers.service';
import { SeoService } from '../../services/seo.service';
import { formatPaperDate, paperTypeLabel, safeWebUrl } from '../../shared/paper-format';
import { PaperLibraryPanel } from './paper-library-panel';

type Loaded = { paper: Paper } | { missing: true } | { failed: true };

@Component({
  selector: 'app-paper-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Breadcrumbs, ConceptDiscussion, PaperLibraryPanel],
  templateUrl: './paper-detail.html',
  styleUrl: './paper-detail.css',
})
export class PaperDetailPage {
  private papers = inject(PapersService);
  private route = inject(ActivatedRoute);
  private seo = inject(SeoService);
  private locale = inject(LOCALE_ID);

  protected readonly paperTypeLabel = paperTypeLabel;
  protected readonly papersLabel = $localize`:@@papers.title:Papers`;

  protected paper = signal<Paper | null>(null);
  protected loading = signal(true);
  protected notFound = signal(false);
  protected failed = signal(false);

  /** Papers have one discussion for every language: the paper is the same whoever reads it. */
  protected topic = computed<DiscussionTopic | null>(() => {
    const paper = this.paper();
    return paper ? { module: 'papers', slug: String(paper.id), lang: 'en' } : null;
  });
  protected breadcrumbs = computed<BreadcrumbItem[]>(() => {
    const paper = this.paper();
    return [
      { name: this.papersLabel, path: '/papers' },
      ...(paper ? [{ name: paper.title, path: `/papers/${paper.id}` }] : []),
    ];
  });
  protected date = computed(() => {
    const date = this.paper()?.publicationDate;
    return date ? formatPaperDate(date, this.locale) : null;
  });
  protected doiUrl = computed(() => {
    const doi = this.paper()?.doi;
    return doi ? `https://doi.org/${doi}` : null;
  });
  protected sourceUrl = computed(() => safeWebUrl(this.paper()?.url ?? null));
  protected paragraphs = computed(() =>
    (this.paper()?.abstract ?? '')
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean),
  );

  private request = new Subject<string>();

  constructor() {
    this.request
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.notFound.set(false);
          this.failed.set(false);
          this.paper.set(null);
        }),
        switchMap((id): Observable<Loaded> => {
          if (!/^[1-9]\d{0,9}$/.test(id)) return of({ missing: true });
          return this.papers.get(Number(id)).pipe(
            map((paper) => ({ paper })),
            catchError((err) => of<Loaded>(err?.status === 404 ? { missing: true } : { failed: true })),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        this.loading.set(false);
        if ('paper' in result) {
          this.paper.set(result.paper);
          this.seo.set({
            title: result.paper.title,
            description: this.describe(result.paper),
            path: `/papers/${result.paper.id}`,
            breadcrumbs: [{ name: 'Papers', path: '/papers' }, { name: result.paper.title, path: `/papers/${result.paper.id}` }],
          });
        } else if ('missing' in result) {
          this.notFound.set(true);
          this.seo.setNotFound();
        } else {
          this.failed.set(true);
        }
      });

    this.route.paramMap.pipe(map((p) => p.get('id') ?? ''), takeUntilDestroyed()).subscribe((id) => this.request.next(id));
  }

  protected retry(): void {
    this.request.next(this.route.snapshot.paramMap.get('id') ?? '');
  }

  protected orcidUrl(orcid: string): string {
    return `https://orcid.org/${orcid}`;
  }

  /** What a search result shows under the title: the start of the abstract, or who wrote it. */
  private describe(paper: Paper): string {
    const text = paper.abstract?.replace(/\s+/g, ' ').trim();
    if (text) return text.length > 200 ? `${text.slice(0, 197).trimEnd()}...` : text;
    const authors = paper.authors.map((a) => a.name).join(', ');
    return authors ? `${paper.title} by ${authors}.` : paper.title;
  }
}
