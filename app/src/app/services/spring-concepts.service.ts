import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { SpringConcept, SpringConceptSummary } from '../models/spring-concept.model';
import { LanguageService } from './language.service';

@Injectable({ providedIn: 'root' })
export class SpringConceptsService {
  private http = inject(HttpClient);
  private language = inject(LanguageService);
  private base = '/api/spring-concepts';

  listConcepts(): Observable<SpringConceptSummary[]> {
    return this.http.get<SpringConceptSummary[]>(this.base, {
      params: { lang: this.language.language() },
    });
  }

  getConcept(slug: string): Observable<SpringConcept> {
    return this.http.get<SpringConcept>(`${this.base}/${slug}`, {
      params: { lang: this.language.language() },
    });
  }

  markRead(slug: string): Observable<{ read: boolean }> {
    return this.http.put<{ read: boolean }>(`${this.base}/${slug}/read`, {});
  }
}
