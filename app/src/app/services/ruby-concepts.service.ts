import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { RubyConcept, RubyConceptSummary } from '../models/ruby-concept.model';
import { LanguageService } from './language.service';

@Injectable({ providedIn: 'root' })
export class RubyConceptsService {
  private http = inject(HttpClient);
  private language = inject(LanguageService);
  private base = '/api/ruby-concepts';

  listConcepts(): Observable<RubyConceptSummary[]> {
    return this.http.get<RubyConceptSummary[]>(this.base, {
      params: { lang: this.language.language },
    });
  }

  getConcept(slug: string): Observable<RubyConcept> {
    return this.http.get<RubyConcept>(`${this.base}/${slug}`, {
      params: { lang: this.language.language },
    });
  }

  markRead(slug: string): Observable<{ read: boolean }> {
    return this.http.put<{ read: boolean }>(`${this.base}/${slug}/read`, {});
  }
}
