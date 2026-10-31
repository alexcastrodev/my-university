import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { PaperFacets, PaperPage, PaperQuery, PublicPaper } from '../models/paper.model';
import { LanguageService } from './language.service';

@Injectable({ providedIn: 'root' })
export class PapersService {
  private http = inject(HttpClient);
  private language = inject(LanguageService);
  private base = '/api/papers';

  list(query: PaperQuery): Observable<PaperPage> {
    let params = new HttpParams().set('lang', this.language.language);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<PaperPage>(this.base, { params });
  }

  facets(): Observable<PaperFacets> {
    return this.http.get<PaperFacets>(`${this.base}/facets`);
  }

  /** A catalog paper by its slug, with its analysis in the reader's language (English when it has no translation). */
  get(slug: string): Observable<PublicPaper> {
    return this.http.get<PublicPaper>(`${this.base}/${slug}`, { params: { lang: this.language.language } });
  }
}
