import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { CSharpConcept, CSharpConceptSummary } from '../models/csharp-concept.model';
import { LanguageService } from './language.service';

@Injectable({ providedIn: 'root' })
export class CSharpConceptsService {
  private http = inject(HttpClient);
  private language = inject(LanguageService);
  private base = '/api/csharp-concepts';

  listConcepts(): Observable<CSharpConceptSummary[]> {
    return this.http.get<CSharpConceptSummary[]>(this.base, {
      params: { lang: this.language.language },
    });
  }

  getConcept(slug: string): Observable<CSharpConcept> {
    return this.http.get<CSharpConcept>(`${this.base}/${slug}`, {
      params: { lang: this.language.language },
    });
  }

  markRead(slug: string): Observable<{ read: boolean }> {
    return this.http.put<{ read: boolean }>(`${this.base}/${slug}/read`, {});
  }
}
