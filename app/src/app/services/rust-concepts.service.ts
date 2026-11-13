import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { RustConcept, RustConceptSummary } from '../models/rust-concept.model';
import { LanguageService } from './language.service';

@Injectable({ providedIn: 'root' })
export class RustConceptsService {
  private http = inject(HttpClient);
  private language = inject(LanguageService);
  private base = '/api/rust-concepts';

  listConcepts(): Observable<RustConceptSummary[]> {
    return this.http.get<RustConceptSummary[]>(this.base, {
      params: { lang: this.language.language },
    });
  }

  getConcept(slug: string): Observable<RustConcept> {
    return this.http.get<RustConcept>(`${this.base}/${slug}`, {
      params: { lang: this.language.language },
    });
  }

  markRead(slug: string): Observable<{ read: boolean }> {
    return this.http.put<{ read: boolean }>(`${this.base}/${slug}/read`, {});
  }
}
