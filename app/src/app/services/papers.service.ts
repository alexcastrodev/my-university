import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { Paper, PaperAnalysis, PaperFacets, PaperPage, PaperQuery } from '../models/paper.model';

@Injectable({ providedIn: 'root' })
export class PapersService {
  private http = inject(HttpClient);
  private base = '/api/papers';

  list(query: PaperQuery): Observable<PaperPage> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<PaperPage>(this.base, { params });
  }

  facets(): Observable<PaperFacets> {
    return this.http.get<PaperFacets>(`${this.base}/facets`);
  }

  /** A paper by its public id. An id from before public ids is answered with a redirect, which the browser follows. */
  get(id: string): Observable<Paper> {
    return this.http.get<Paper>(`${this.base}/${id}`);
  }

  /** The published analysis of a paper, or null when it has none. */
  analysis(id: string): Observable<PaperAnalysis | null> {
    return this.http.get<{ analysis: PaperAnalysis | null }>(`${this.base}/${id}/analysis`).pipe(map((r) => r.analysis));
  }
}
