import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, LOCALE_ID, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { finalize } from 'rxjs';
import { PaperAttachment } from '../../models/paper.model';
import { MAX_PDF_BYTES, PaperAttachmentsService } from '../../services/paper-attachments.service';
import { attachmentErrorMessage, formatFileSize, formatPaperDate } from '../../shared/paper-format';

/** The reader's own PDF of a paper: upload, replace, download, remove. Lives on the library page, which only the browser renders. */
@Component({
  selector: 'app-paper-attachment-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './paper-attachment-panel.html',
  styleUrl: './paper-attachment-panel.css',
})
export class PaperAttachmentPanel {
  readonly paperId = input.required<string>();

  private attachments = inject(PaperAttachmentsService);
  private locale = inject(LOCALE_ID);

  protected attachment = signal<PaperAttachment | null>(null);
  protected loading = signal(true);
  protected loadFailed = signal(false);
  protected uploading = signal(false);
  protected removing = signal(false);
  protected confirmRemove = signal(false);
  /** Why the last upload or removal failed, as the API's code (or `generic`). */
  protected errorCode = signal<string | null>(null);

  protected errorText = computed(() => attachmentErrorMessage(this.errorCode()));
  protected busy = computed(() => this.uploading() || this.removing());
  protected fileUrl = computed(() => this.attachments.fileUrl(this.paperId()));

  /** The file being served: the version that passed its checks. */
  protected current = computed(() => {
    const a = this.attachment();
    return a?.versions.find((v) => v.version === a.current) ?? null;
  });
  /**
   * The newest upload when it was refused, as stored: still there after a reload. The old file keeps being
   * served; this says why the new one was not. Hidden while this visit has an error of its own to show.
   */
  protected refusal = computed(() => {
    if (this.errorCode()) return null;
    const newest = this.attachment()?.versions[0];
    return newest?.state === 'rejected' ? attachmentErrorMessage(newest.rejectCode) : null;
  });
  protected size = computed(() => {
    const v = this.current();
    return v ? formatFileSize(v.size, this.locale) : '';
  });
  protected uploadedOn = computed(() => {
    const v = this.current();
    return v ? formatPaperDate(v.uploadedAt.slice(0, 10), this.locale) : '';
  });

  constructor() {
    effect(() => {
      const id = this.paperId();
      untracked(() => this.load(id));
    });
  }

  protected load(id = this.paperId()): void {
    this.loading.set(true);
    this.loadFailed.set(false);
    this.attachments.get(id).subscribe({
      next: (attachment) => {
        this.attachment.set(attachment);
        this.loading.set(false);
      },
      error: () => {
        this.loadFailed.set(true);
        this.loading.set(false);
      },
    });
  }

  protected pick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0);
    // Cleared so picking the same file again after a refusal still fires a change.
    input.value = '';
    if (!file) return;
    this.errorCode.set(null);
    if (file.size > MAX_PDF_BYTES) {
      this.errorCode.set('too_large');
      return;
    }
    this.uploading.set(true);
    this.attachments
      .upload(this.paperId(), file)
      .pipe(finalize(() => this.uploading.set(false)))
      .subscribe({
        next: (attachment) => this.attachment.set(attachment),
        // nginx answers an oversized body with a plain 413, without the API's code.
        error: (err: HttpErrorResponse) => this.errorCode.set(err.error?.code ?? (err.status === 413 ? 'too_large' : 'generic')),
      });
  }

  protected remove(): void {
    this.confirmRemove.set(false);
    this.errorCode.set(null);
    this.removing.set(true);
    this.attachments
      .remove(this.paperId())
      .pipe(finalize(() => this.removing.set(false)))
      .subscribe({
        next: () => this.attachment.set(null),
        error: () => this.errorCode.set('generic'),
      });
  }
}
