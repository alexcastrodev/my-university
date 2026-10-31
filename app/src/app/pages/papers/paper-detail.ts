import { ChangeDetectionStrategy, Component, LOCALE_ID, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DomSanitizer } from '@angular/platform-browser';
import { Observable, Subject, catchError, map, of, switchMap, tap } from 'rxjs';
import { BreadcrumbItem, Breadcrumbs } from '../../components/breadcrumbs/breadcrumbs';
import { ConceptDiscussion } from '../../components/concept-discussion/concept-discussion';
import { DiscussionTopic } from '../../discussion/discussion.model';
import { Language } from '../../models/language.model';
import { PublicPaper } from '../../models/paper.model';
import { PapersService } from '../../services/papers.service';
import { SeoService } from '../../services/seo.service';
import { formatPaperDate, paperTypeLabel, paragraphsOf, safeWebUrl } from '../../shared/paper-format';
import { parseMarkdown } from '../../shared/markdown';
import { isPaperSlug } from '../../shared/paper-id';
import { PaperLibraryButton } from './paper-library-button';
import { PaperStage } from './paper-stage';

type Loaded = { paper: PublicPaper } | { missing: true } | { failed: true };

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
  private seo = inject(SeoService);
  private sanitizer = inject(DomSanitizer);
  private locale = inject(LOCALE_ID);

  protected readonly paperTypeLabel = paperTypeLabel;
  protected readonly papersLabel = $localize`:@@papers.title:Papers`;

  protected paper = signal<PublicPaper | null>(null);
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
  /** The analysis is markdown, one `##` section at a time, rendered the way the concepts are. */
  protected sections = computed(() =>
    (this.paper()?.sections ?? []).map((s) => ({ title: s.title, html: parseMarkdown(this.sanitizer, s.content).html })),
  );
  protected revised = computed(() => {
    const date = this.paper()?.updatedAt;
    return date ? formatPaperDate(date, this.locale) : null;
  });

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
        switchMap((slug): Observable<Loaded> => {
          if (!isPaperSlug(slug)) return of({ missing: true });
          return this.papers.get(slug).pipe(
            map((paper): Loaded => ({ paper })),
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
            alternates: this.alternatesFor(result.paper),
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
  private describe(paper: PublicPaper): string {
    const text = paper.abstract?.replace(/\s+/g, ' ').trim();
    if (text) return text.length > 200 ? `${text.slice(0, 197).trimEnd()}...` : text;
    const authors = paper.authors.map((a) => a.name).join(', ');
    return authors ? `${paper.title} by ${authors}.` : paper.title;
  }

  /** hreflang only for translations that exist, never the English fallback. */
  private alternatesFor(paper: PublicPaper): { lang: Language; path: string }[] {
    const alternates: { lang: Language; path: string }[] = [{ lang: 'en', path: `/papers/${paper.id}` }];
    if (paper.availableLanguages.includes('pt-BR')) alternates.push({ lang: 'pt-BR', path: `/pt-BR/papers/${paper.id}` });
    return alternates;
  }
}
