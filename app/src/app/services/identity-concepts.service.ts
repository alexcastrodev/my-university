import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { IdentityConcept, IdentityConceptSummary } from '../models/identity-concept.model';
import { LanguageService } from './language.service';

@Injectable({ providedIn: 'root' })
export class IdentityConceptsService {
  private http = inject(HttpClient);
  private language = inject(LanguageService);
  private base = '/api/identity-concepts';

  listConcepts(): Observable<IdentityConceptSummary[]> {
    return this.http.get<IdentityConceptSummary[]>(this.base, {
      params: { lang: this.language.language },
    });
  }

  getConcept(slug: string): Observable<IdentityConcept> {
    return this.http.get<IdentityConcept>(`${this.base}/${slug}`, {
      params: { lang: this.language.language },
    });
  }

  markRead(slug: string): Observable<{ read: boolean }> {
    return this.http.put<{ read: boolean }>(`${this.base}/${slug}/read`, {});
  }
}
