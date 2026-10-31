import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, LOCALE_ID, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ImportPreview, PAPER_TYPES, PaperInput, PaperType } from '../../models/paper.model';
import { AuthService } from '../../services/auth.service';
import { PapersService } from '../../services/papers.service';
import { SeoService } from '../../services/seo.service';
import { formatPaperDate, paperTypeLabel } from '../../shared/paper-format';

type LookupFailure =
  | { kind: 'invalid' | 'not_found' | 'unavailable' | 'signed_out' | 'failed' }
  | { kind: 'rate_limited'; retryAfter: number | null };

interface ManualForm {
  title: string;
  authors: string;
  publicationDate: string;
  venue: string;
  doi: string;
  url: string;
  type: PaperType | '';
  researchArea: string;
  keywords: string;
  abstract: string;
}

const EMPTY_FORM: ManualForm = {
  title: '',
  authors: '',
  publicationDate: '',
  venue: '',
  doi: '',
  url: '',
  type: '',
  researchArea: '',
  keywords: '',
  abstract: '',
};

/** The reason the provider lookup failed, from the code the API puts on every error. */
function failureOf(err: HttpErrorResponse): LookupFailure {
  if (err.status === 401) return { kind: 'signed_out' };
  switch (err.error?.code) {
    case 'invalid_doi':
      return { kind: 'invalid' };
    case 'not_found':
      return { kind: 'not_found' };
    case 'rate_limited':
    case 'too_many_requests':
      return { kind: 'rate_limited', retryAfter: Number(err.error?.retryAfter) || null };
    case 'provider_unavailable':
    case 'provider_invalid':
      return { kind: 'unavailable' };
    default:
      return err.status === 400 ? { kind: 'invalid' } : { kind: 'failed' };
  }
}

@Component({
  selector: 'app-paper-add',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './paper-add.html',
  styleUrl: './paper-add.css',
})
export class PaperAddPage {
  private papers = inject(PapersService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private locale = inject(LOCALE_ID);

  protected readonly types = PAPER_TYPES;
  protected readonly paperTypeLabel = paperTypeLabel;

  protected signedIn = computed(() => this.auth.currentUser() !== null);

  protected doi = signal('');
  protected looking = signal(false);
  protected found = signal<ImportPreview | null>(null);
  protected failure = signal<LookupFailure | null>(null);
  protected adding = signal(false);

  protected manualOpen = signal(false);
  protected form = signal<ManualForm>({ ...EMPTY_FORM });
  protected saving = signal(false);
  protected saveError = signal<string | null>(null);
  protected existingId = signal<string | null>(null);
  protected canSave = computed(() => this.form().title.trim().length > 0 && !this.saving());

  protected failureText = computed(() => {
    const failure = this.failure();
    switch (failure?.kind) {
      case 'invalid':
        return $localize`:@@papers.add.error.invalid:That does not look like a DOI. It looks like 10.1234/abc or https://doi.org/10.1234/abc.`;
      case 'not_found':
        return $localize`:@@papers.add.error.notFound:Crossref has no record for this DOI. You can enter the details by hand.`;
      case 'unavailable':
        return $localize`:@@papers.add.error.unavailable:Crossref could not be reached right now. Try again, or enter the details by hand.`;
      case 'rate_limited':
        return failure.retryAfter
          ? $localize`:@@papers.add.error.rateLimitedWait:Too many lookups. Try again in ${failure.retryAfter}:seconds: seconds.`
          : $localize`:@@papers.add.error.rateLimited:Too many lookups. Try again in a few minutes.`;
      case 'signed_out':
        return $localize`:@@papers.add.error.signedOut:Your session ended. Sign in again to add papers.`;
      case 'failed':
        return $localize`:@@papers.add.error.failed:The lookup failed. Try again.`;
      default:
        return null;
    }
  });

  constructor() {
    inject(SeoService).set({
      title: $localize`:@@papers.add.title:Add a paper`,
      description: $localize`:@@papers.add.subtitle:Look a paper up by its DOI, check what was found, then add it to the catalog. Or enter the details yourself.`,
      path: '/papers/new',
      noindex: true,
    });
  }

  protected onLookup(event: Event): void {
    event.preventDefault();
    const doi = this.doi().trim();
    if (!doi || this.looking()) return;
    this.looking.set(true);
    this.found.set(null);
    this.failure.set(null);
    this.papers.previewImport(doi).subscribe({
      next: (preview) => {
        this.looking.set(false);
        this.found.set(preview);
      },
      error: (err: HttpErrorResponse) => {
        const failure = failureOf(err);
        this.looking.set(false);
        this.failure.set(failure);
        // A provider that cannot help never blocks adding the paper: the form opens on its own.
        if (failure.kind === 'not_found' || failure.kind === 'unavailable') this.manualOpen.set(true);
      },
    });
  }

  protected onAdd(): void {
    const found = this.found();
    if (!found || found.match || this.adding()) return;
    this.adding.set(true);
    this.papers.importDoi(found.doi).subscribe({
      next: (result) => void this.router.navigate(['/papers', result.paper.id]),
      error: (err: HttpErrorResponse) => {
        this.adding.set(false);
        this.found.set(null);
        this.failure.set(failureOf(err));
      },
    });
  }

  protected toggleManual(): void {
    this.manualOpen.update((open) => !open);
  }

  protected setField(field: keyof ManualForm, value: string): void {
    this.form.update((form) => ({ ...form, [field]: value }));
  }

  protected onSave(event: Event): void {
    event.preventDefault();
    if (!this.canSave()) return;
    this.saving.set(true);
    this.saveError.set(null);
    this.existingId.set(null);
    this.papers.create(this.input(this.form())).subscribe({
      next: (result) => void this.router.navigate(['/papers', result.paper.id]),
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        if (err.error?.code === 'already_exists') {
          this.existingId.set(String(err.error.paperId));
        } else if (err.status === 401) {
          this.saveError.set($localize`:@@papers.add.error.signedOut:Your session ended. Sign in again to add papers.`);
        } else if (err.status === 429) {
          this.saveError.set($localize`:@@papers.add.error.rateLimited:Too many lookups. Try again in a few minutes.`);
        } else if (err.status === 400) {
          const message = err.error?.message;
          this.saveError.set(Array.isArray(message) ? message.join('. ') : String(message ?? ''));
        } else {
          this.saveError.set($localize`:@@papers.add.error.saveFailed:The paper could not be saved. Try again.`);
        }
      },
    });
  }

  protected date(value: string): string {
    return formatPaperDate(value, this.locale);
  }

  protected names(preview: ImportPreview): string {
    return (preview.candidate.authors ?? []).map((a) => a.name).join('; ');
  }

  /** The form as the API takes it: only what was filled in, authors one per line, keywords split on commas. */
  private input(form: ManualForm): PaperInput {
    const text = (value: string) => value.trim() || undefined;
    const authors = form.authors
      .split('\n')
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => ({ name }));
    const keywords = form.keywords
      .split(/[,;]/)
      .map((k) => k.trim())
      .filter(Boolean);
    return {
      title: form.title.trim(),
      abstract: text(form.abstract),
      doi: text(form.doi),
      venue: text(form.venue),
      publicationDate: text(form.publicationDate),
      url: text(form.url),
      researchArea: text(form.researchArea),
      type: form.type || undefined,
      authors: authors.length ? authors : undefined,
      keywords: keywords.length ? keywords : undefined,
    };
  }
}
