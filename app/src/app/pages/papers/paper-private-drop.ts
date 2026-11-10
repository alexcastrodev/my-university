import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, LOCALE_ID, computed, inject, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { PrivatePaperResult } from '../../models/paper.model';
import { MAX_PDF_BYTES } from '../../services/paper-attachments.service';
import { PaperLibraryService } from '../../services/paper-library.service';
import { attachmentErrorMessage, formatFileSize } from '../../shared/paper-format';

const MAX_TITLE = 300;

/** "my_paper-v2.pdf" as a first guess at a title: the reader fixes it before anything is sent. */
export function titleFromFilename(name: string): string {
  return name
    .trim()
    .replace(/\.pdf$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE);
}

/**
 * Adds a paper that is not in the catalog (#203): drop a PDF (or pick one, which is also what a phone does),
 * say what it is, and it joins the library as a private paper. A DOI that is already in the catalog adds that
 * paper instead of a copy. Nothing is sent until the reader confirms the title.
 */
@Component({
  selector: 'app-paper-private-drop',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './paper-private-drop.html',
  styleUrl: './paper-private-drop.css',
})
export class PaperPrivateDrop {
  private library = inject(PaperLibraryService);
  private locale = inject(LOCALE_ID);

  /** Fires after a paper was added, so the list behind this can reload. */
  readonly added = output<PrivatePaperResult>();

  protected readonly maxTitle = MAX_TITLE;
  protected file = signal<File | null>(null);
  protected title = signal('');
  protected doi = signal('');
  protected dragging = signal(false);
  protected uploading = signal(false);
  protected errorCode = signal<string | null>(null);
  protected result = signal<PrivatePaperResult | null>(null);

  protected errorText = computed(() => attachmentErrorMessage(this.errorCode()));
  protected size = computed(() => {
    const f = this.file();
    return f ? formatFileSize(f.size, this.locale) : '';
  });
  protected canSubmit = computed(() => !!this.file() && !!this.title().trim() && !this.uploading());

  protected pick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0);
    // Cleared so picking the same file again after a refusal still fires a change.
    input.value = '';
    if (file) this.choose(file);
  }

  protected over(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected drop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files.item(0);
    if (file) this.choose(file);
  }

  protected cancel(): void {
    this.file.set(null);
    this.errorCode.set(null);
  }

  protected submit(event: Event): void {
    event.preventDefault();
    const file = this.file();
    if (!file || !this.canSubmit()) return;
    this.errorCode.set(null);
    this.uploading.set(true);
    this.library
      .addFromPdf(file, this.title().trim(), this.doi().trim())
      .pipe(finalize(() => this.uploading.set(false)))
      .subscribe({
        next: (result) => {
          this.result.set(result);
          this.file.set(null);
          this.title.set('');
          this.doi.set('');
          this.added.emit(result);
        },
        // nginx answers an oversized body with a plain 413, without the API's code.
        error: (err: HttpErrorResponse) => this.errorCode.set(err.error?.code ?? (err.status === 413 ? 'too_large' : 'generic')),
      });
  }

  private choose(file: File): void {
    this.result.set(null);
    this.errorCode.set(null);
    if (file.size > MAX_PDF_BYTES) {
      this.file.set(null);
      this.errorCode.set('too_large');
      return;
    }
    this.file.set(file);
    this.title.set(titleFromFilename(file.name));
    this.doi.set('');
  }
}
