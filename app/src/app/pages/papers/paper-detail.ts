import { ChangeDetectionStrategy, Component, LOCALE_ID, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EMPTY, Observable, Subject, catchError, forkJoin, map, of, switchMap, tap } from 'rxjs';
import { BreadcrumbItem, Breadcrumbs } from '../../components/breadcrumbs/breadcrumbs';
import { ConceptDiscussion } from '../../components/concept-discussion/concept-discussion';
import { DiscussionTopic } from '../../discussion/discussion.model';
import { ANALYSIS_SECTIONS, AnalysisSection, AnalysisSectionKey, Paper, PaperAnalysis } from '../../models/paper.model';
import { PapersService } from '../../services/papers.service';
import { SeoService } from '../../services/seo.service';
import {
  analysisSectionTitle,
  analysisStateLabel,
  formatPaperDate,
  paperTypeLabel,
  paragraphsOf,
  safeWebUrl,
} from '../../shared/paper-format';
import { isLegacyPaperId, isPaperId } from '../../shared/paper-id';
import { PaperLibraryButton } from './paper-library-button';
import { PaperStage } from './paper-stage';

/** `analysis` is null when the paper has none, and `'failed'` when only that request failed: the paper still shows. */
type Loaded = { paper: Paper; analysis: PaperAnalysis | null | 'failed' } | { missing: true } | { failed: true };

@Component({
  selector: 'app-paper-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Breadcrumbs, ConceptDiscussion, PaperLibraryButton, PaperStage],
  templateUrl: './paper-detail.html',
  styleUrl: './paper-detail.css',
})
export class PaperDetailPage {
  private papers = inject(PapersService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private seo = inject(SeoService);
  private locale = inject(LOCALE_ID);

  protected readonly paperTypeLabel = paperTypeLabel;
  protected readonly analysisSectionTitle = analysisSectionTitle;
  protected readonly analysisStateLabel = analysisStateLabel;
  protected readonly paragraphsOf = paragraphsOf;
  protected readonly sectionKeys = ANALYSIS_SECTIONS;
  protected readonly papersLabel = $localize`:@@papers.title:Papers`;

  protected paper = signal<Paper | null>(null);
  protected analysis = signal<PaperAnalysis | null>(null);
  protected analysisFailed = signal(false);
  protected loading = signal(true);
  protected notFound = signal(false);
  protected failed = signal(false);

  /** Papers have one discussion for every language: the paper is the same whoever reads it. */
  protected topic = computed<DiscussionTopic | null>(() => {
    const paper = this.paper();
    return paper ? { module: 'papers', slug: paper.id, lang: 'en' } : null;
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
  protected paragraphs = computed(() => paragraphsOf(this.paper()?.abstract ?? null));

  private request = new Subject<string>();

  constructor() {
    this.request
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.notFound.set(false);
          this.failed.set(false);
          this.paper.set(null);
          this.analysis.set(null);
          this.analysisFailed.set(false);
        }),
        switchMap((id): Observable<Loaded> => {
          if (isLegacyPaperId(id)) {
            // A link from before public ids: the API answers it with a redirect, and the address follows it.
            return this.papers.get(id).pipe(
              tap((paper) => void this.router.navigate(['/papers', paper.id], { replaceUrl: true })),
              switchMap(() => EMPTY),
              catchError((err) => of<Loaded>(err?.status === 404 ? { missing: true } : { failed: true })),
            );
          }
          if (!isPaperId(id)) return of({ missing: true });
          return forkJoin({
            paper: this.papers.get(id),
            analysis: this.papers.analysis(id).pipe(catchError(() => of('failed' as const))),
          }).pipe(
            catchError((err) => of<Loaded>(err?.status === 404 ? { missing: true } : { failed: true })),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        this.loading.set(false);
        if ('paper' in result) {
          this.paper.set(result.paper);
          this.analysisFailed.set(result.analysis === 'failed');
          this.analysis.set(result.analysis === 'failed' ? null : result.analysis);
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

  /** A section of the published analysis; every published analysis has all six, but the type does not say so. */
  protected section(analysis: PaperAnalysis, key: AnalysisSectionKey): AnalysisSection | null {
    return analysis.sections[key] ?? null;
  }

  /** The day it was published, as far as the reader's language writes it. */
  protected publishedOn(analysis: PaperAnalysis): string {
    return formatPaperDate(analysis.publishedAt.slice(0, 10), this.locale);
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
