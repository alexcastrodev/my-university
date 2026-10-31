import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, of, throwError } from 'rxjs';
import { AddPaperResult, ImportPreview, LibraryChange, LibraryEntry, LibraryFacets, LibraryPage, LibraryQuery, Paper, PaperInput, PrivatePaperResult } from '../models/paper.model';

/** The signed-in reader's private paper library. Every call needs a session (401 without one). */
@Injectable({ providedIn: 'root' })
export class PaperLibraryService {
  private http = inject(HttpClient);
  private base = '/api/paper-library';

  list(query: LibraryQuery): Observable<LibraryPage> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<LibraryPage>(this.base, { params });
  }

  facets(): Observable<LibraryFacets> {
    return this.http.get<LibraryFacets>(`${this.base}/facets`);
  }

  /** The entry for a paper, or `null` when it is not in the library. */
  get(paperId: string): Observable<LibraryEntry | null> {
    return this.http
      .get<LibraryEntry>(`${this.base}/${paperId}`)
      .pipe(catchError((err) => (err?.status === 404 ? of(null) : throwError(() => err))));
  }

  /** The paper itself, read through the library: a private paper has no public address. 404 when it is not in the library. */
  paper(paperId: string): Observable<Paper> {
    return this.http.get<Paper>(`${this.base}/${paperId}/paper`);
  }

  /** The PDF goes as the raw body, like an attachment; the title and the optional DOI travel in the query. */
  addFromPdf(file: File, title: string, doi: string): Observable<PrivatePaperResult> {
    let params = new HttpParams().set('title', title);
    if (doi) params = params.set('doi', doi);
    return this.http.post<PrivatePaperResult>(`${this.base}/private`, file, {
      params,
      headers: { 'Content-Type': 'application/pdf', 'X-Filename': encodeURIComponent(file.name) },
    });
  }

  /** Looks a DOI up at the provider and says what adding it to the library would do. Changes nothing. */
  previewDoi(doi: string): Observable<ImportPreview> {
    return this.http.post<ImportPreview>(`${this.base}/import/preview`, { doi });
  }

  /** Adds the paper for a DOI: the catalog's if it is there, else a private one. The server fetches the metadata. */
  addByDoi(doi: string): Observable<AddPaperResult> {
    return this.http.post<AddPaperResult>(`${this.base}/import`, { doi });
  }

  /** Adds a paper typed in by hand. 409 `already_exists` with `paperId` when the reader has it. */
  addByHand(input: PaperInput): Observable<AddPaperResult> {
    return this.http.post<AddPaperResult>(`${this.base}/manual`, input);
  }

  add(paperId: string): Observable<LibraryEntry> {
    return this.http.post<LibraryEntry>(this.base, { paperId });
  }

  update(paperId: string, change: LibraryChange): Observable<LibraryEntry> {
    return this.http.patch<LibraryEntry>(`${this.base}/${paperId}`, change);
  }

  remove(paperId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${paperId}`);
  }
}
