import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { DotNetTestingConcept, DotNetTestingConceptSummary } from '../models/dotnet-testing-concept.model';
import { LanguageService } from './language.service';

@Injectable({ providedIn: 'root' })
export class DotNetTestingConceptsService {
  private http = inject(HttpClient);
  private language = inject(LanguageService);
  private base = '/api/dotnet-testing-concepts';

  listConcepts(): Observable<DotNetTestingConceptSummary[]> {
    return this.http.get<DotNetTestingConceptSummary[]>(this.base, {
      params: { lang: this.language.language },
    });
  }

  getConcept(slug: string): Observable<DotNetTestingConcept> {
    return this.http.get<DotNetTestingConcept>(`${this.base}/${slug}`, {
      params: { lang: this.language.language },
    });
  }

  markRead(slug: string): Observable<{ read: boolean }> {
    return this.http.put<{ read: boolean }>(`${this.base}/${slug}/read`, {});
  }
}
