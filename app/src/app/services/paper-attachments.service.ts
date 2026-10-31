import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, of, throwError } from 'rxjs';
import { PaperAttachment } from '../models/paper.model';

/** The most the server accepts by default (PAPER_PDF_MAX_BYTES). The server decides; this only saves a doomed upload. */
export const MAX_PDF_BYTES = 25 * 1024 * 1024;

/** The signed-in reader's private PDF for a paper. Every call needs a session (401 without one). */
@Injectable({ providedIn: 'root' })
export class PaperAttachmentsService {
  private http = inject(HttpClient);

  private base(paperId: string): string {
    return `/api/papers/${paperId}/attachment`;
  }

  /** Where the approved file is downloaded from: a plain link, the session cookie authorizes it. */
  fileUrl(paperId: string): string {
    return `${this.base(paperId)}/file`;
  }

  /** The reader's attachment for a paper, or `null` when there is none. */
  get(paperId: string): Observable<PaperAttachment | null> {
    return this.http
      .get<PaperAttachment>(this.base(paperId))
      .pipe(catchError((err) => (err?.status === 404 ? of(null) : throwError(() => err))));
  }

  /** The approved file's bytes, through the authorized route: the reader never holds a URL to the file. `null` when there is none. */
  file(paperId: string): Observable<ArrayBuffer | null> {
    return this.http
      .get(this.fileUrl(paperId), { responseType: 'arraybuffer' })
      .pipe(catchError((err) => (err?.status === 404 ? of(null) : throwError(() => err))));
  }

  /** The PDF goes as the raw body; what the server decides to accept depends on the bytes, not on this type. */
  upload(paperId: string, file: File): Observable<PaperAttachment> {
    return this.http.put<PaperAttachment>(this.base(paperId), file, {
      headers: { 'Content-Type': 'application/pdf', 'X-Filename': encodeURIComponent(file.name) },
    });
  }

  remove(paperId: string): Observable<void> {
    return this.http.delete<void>(this.base(paperId));
  }
}
