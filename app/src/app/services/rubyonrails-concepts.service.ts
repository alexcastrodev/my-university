import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { RubyOnRailsConcept, RubyOnRailsConceptSummary } from '../models/rubyonrails-concept.model';
import { LanguageService } from './language.service';

@Injectable({ providedIn: 'root' })
export class RubyOnRailsConceptsService {
  private http = inject(HttpClient);
  private language = inject(LanguageService);
  private base = '/api/rubyonrails-concepts';

  listConcepts(): Observable<RubyOnRailsConceptSummary[]> {
    return this.http.get<RubyOnRailsConceptSummary[]>(this.base, {
      params: { lang: this.language.language },
    });
  }

  getConcept(slug: string): Observable<RubyOnRailsConcept> {
    return this.http.get<RubyOnRailsConcept>(`${this.base}/${slug}`, {
      params: { lang: this.language.language },
    });
  }

  markRead(slug: string): Observable<{ read: boolean }> {
    return this.http.put<{ read: boolean }>(`${this.base}/${slug}/read`, {});
  }
}
