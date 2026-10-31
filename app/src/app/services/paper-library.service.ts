import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, of, throwError } from 'rxjs';
import { LibraryChange, LibraryEntry, LibraryFacets, LibraryPage, LibraryQuery } from '../models/paper.model';

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
  get(paperId: number): Observable<LibraryEntry | null> {
    return this.http
      .get<LibraryEntry>(`${this.base}/${paperId}`)
      .pipe(catchError((err) => (err?.status === 404 ? of(null) : throwError(() => err))));
  }

  add(paperId: number): Observable<LibraryEntry> {
    return this.http.post<LibraryEntry>(this.base, { paperId });
  }

  update(paperId: number, change: LibraryChange): Observable<LibraryEntry> {
    return this.http.patch<LibraryEntry>(`${this.base}/${paperId}`, change);
  }

  remove(paperId: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${paperId}`);
  }
}
