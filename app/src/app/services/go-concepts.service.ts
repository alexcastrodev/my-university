import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { GoConcept, GoConceptSummary } from '../models/go-concept.model';
import { LanguageService } from './language.service';

@Injectable({ providedIn: 'root' })
export class GoConceptsService {
  private http = inject(HttpClient);
  private language = inject(LanguageService);
  private base = '/api/go-concepts';

  listConcepts(): Observable<GoConceptSummary[]> {
    return this.http.get<GoConceptSummary[]>(this.base, {
      params: { lang: this.language.language },
    });
  }

  getConcept(slug: string): Observable<GoConcept> {
    return this.http.get<GoConcept>(`${this.base}/${slug}`, {
      params: { lang: this.language.language },
    });
  }

  markRead(slug: string): Observable<{ read: boolean }> {
    return this.http.put<{ read: boolean }>(`${this.base}/${slug}/read`, {});
  }
}
