import { ChangeDetectionStrategy, Component, LOCALE_ID, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EMPTY, Observable, Subject, catchError, finalize, forkJoin, map, of, switchMap, tap } from 'rxjs';
import { LibraryEntry, Paper } from '../../models/paper.model';
import { PaperLibraryService } from '../../services/paper-library.service';
import { PapersService } from '../../services/papers.service';
import { SeoService } from '../../services/seo.service';
import { formatPaperDate, paperTypeLabel, safeWebUrl } from '../../shared/paper-format';
import { isLegacyPaperId, isPaperId } from '../../shared/paper-id';
import { PaperAttachmentPanel } from './paper-attachment-panel';
import { PaperLibraryDetails } from './paper-library-details';
import { PaperStage } from './paper-stage';

type Loaded = { paper: Paper; entry: LibraryEntry } | 'signedOut' | 'missing' | 'failed';

/**
 * One paper in the reader's library: the record and what the reader keeps about it. The record is read through
 * the library, so a private paper (#203) works like any other. The public page (and its discussion) is a link
 * away, never part of this one, and a private paper has none. Client-rendered, private.
 */
@Component({
  selector: 'app-paper-library-entry',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PaperAttachmentPanel, PaperLibraryDetails, PaperStage],
  templateUrl: './paper-library-entry.html',
  styleUrls: ['./paper-detail.css', './paper-library-entry.css'],
})
export class PaperLibraryEntryPage {
  private library = inject(PaperLibraryService);
  private papers = inject(PapersService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private seo = inject(SeoService);
  private locale = inject(LOCALE_ID);

  protected readonly paperTypeLabel = paperTypeLabel;

  protected state = signal<'loading' | 'ready' | 'signedOut' | 'missing' | 'failed'>('loading');
  protected paper = signal<Paper | null>(null);
  protected entry = signal<LibraryEntry | null>(null);
  protected confirmingRemove = signal(false);
  protected removing = signal(false);
  protected removeFailed = signal(false);

  protected date = computed(() => {
    const date = this.paper()?.publicationDate;
    return date ? formatPaperDate(date, this.locale) : null;
  });
  protected doiUrl = computed(() => {
    const doi = this.paper()?.doi;
    return doi ? `https://doi.org/${doi}` : null;
  });
  protected authorNames = (paper: Paper) => paper.authors.map((a) => a.name).join('; ');
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
          this.state.set('loading');
          this.confirmingRemove.set(false);
          this.removeFailed.set(false);
        }),
        switchMap((id): Observable<Loaded> => {
          if (isLegacyPaperId(id)) {
            // A link from before public ids: the API answers it with a redirect, and the address follows it.
            return this.papers.get(id).pipe(
              tap((paper) => void this.router.navigate(['/library', paper.id], { replaceUrl: true })),
              switchMap(() => EMPTY),
              catchError((err): Observable<Loaded> => of(err?.status === 404 ? 'missing' : 'failed')),
            );
          }
          if (!isPaperId(id)) return of('missing');
          return forkJoin([this.library.get(id), this.library.paper(id)]).pipe(
            map(([entry, paper]): Loaded => (entry ? { entry, paper } : 'missing')),
            catchError((err): Observable<Loaded> => of(err?.status === 401 ? 'signedOut' : err?.status === 404 ? 'missing' : 'failed')),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        if (typeof result === 'string') {
          this.state.set(result);
          return;
        }
        this.paper.set(result.paper);
        this.entry.set(result.entry);
        this.state.set('ready');
        this.seo.set({
          title: result.paper.title,
          description: 'A paper in your library.',
          path: `/library/${result.paper.id}`,
          noindex: true,
        });
      });

    this.route.paramMap.pipe(map((p) => p.get('paperId') ?? ''), takeUntilDestroyed()).subscribe((id) => this.request.next(id));
  }

  protected retry(): void {
    this.request.next(this.route.snapshot.paramMap.get('paperId') ?? '');
  }

  protected remove(paperId: string): void {
    this.removeFailed.set(false);
    this.removing.set(true);
    this.library
      .remove(paperId)
      .pipe(finalize(() => this.removing.set(false)))
      .subscribe({
        next: () => void this.router.navigate(['/library']),
        error: () => this.removeFailed.set(true),
      });
  }
}
